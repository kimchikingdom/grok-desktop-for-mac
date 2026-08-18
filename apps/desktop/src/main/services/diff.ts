import { execFile } from 'node:child_process';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createTwoFilesPatch } from 'diff';
import { MAX_INLINE_FILE_BYTES, looksBinary, maskSecrets, sanitizeEnvironment } from '@grok-desktop/security';
import type { DiffPreview, FileChangeSummary } from '@grok-desktop/shared';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);
const MAX_DIFF_CHARS = 200_000;

export function buildDiffPreview(
  relPath: string,
  absPath: string,
  before: string | null,
  after: string | null,
): DiffPreview {
  const binary = looksBinary(relPath);
  if (binary) {
    return { path: absPath, relPath, unifiedDiff: '', additions: 0, deletions: 0, truncated: false, binary: true };
  }

  const patch = createTwoFilesPatch(
    before === null ? '/dev/null' : `a/${relPath}`,
    after === null ? '/dev/null' : `b/${relPath}`,
    before ?? '',
    after ?? '',
    undefined,
    undefined,
    { context: 3 },
  );

  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }

  const truncated = patch.length > MAX_DIFF_CHARS;
  return {
    path: absPath,
    relPath,
    unifiedDiff: maskSecrets(truncated ? `${patch.slice(0, MAX_DIFF_CHARS)}\n… (생략됨)` : patch),
    additions,
    deletions,
    truncated,
    binary: false,
  };
}

/** Wrap a patch produced by Git in the shape the UI expects. */
export function previewFromPatch(relPath: string, canonicalRoot: string, patch: string): DiffPreview {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  const truncated = patch.length > MAX_DIFF_CHARS;
  return {
    path: path.join(canonicalRoot, relPath),
    relPath,
    unifiedDiff: truncated ? `${patch.slice(0, MAX_DIFF_CHARS)}\n… (생략됨)` : patch,
    additions,
    deletions,
    truncated,
    binary: false,
  };
}

type Snapshot = {
  relPath: string;
  absPath: string;
  before: string | null;
  after: string | null;
};

/**
 * Tracks the pre-change content of every file the agent writes through the app,
 * so the UI can show a real diff (spec 6.4) and offer a revert (spec 4 phase 4).
 */
export class ChangeTracker {
  #bySession = new Map<string, Map<string, Snapshot>>();

  #sessionMap(sessionId: string): Map<string, Snapshot> {
    let map = this.#bySession.get(sessionId);
    if (!map) {
      map = new Map();
      this.#bySession.set(sessionId, map);
    }
    return map;
  }

  /** Call immediately before a write is executed. */
  async captureBefore(sessionId: string, absPath: string, relPath: string): Promise<void> {
    const map = this.#sessionMap(sessionId);
    if (map.has(relPath)) return; // keep the original pre-session content
    const before = await readFile(absPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    map.set(relPath, { relPath, absPath, before, after: null });
  }

  /** Call right after the write succeeded; returns the summary for the UI. */
  async recordAfter(sessionId: string, absPath: string, relPath: string): Promise<FileChangeSummary> {
    const map = this.#sessionMap(sessionId);
    const snapshot = map.get(relPath) ?? { relPath, absPath, before: null, after: null };
    const after = await readFile(absPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    snapshot.after = after;
    map.set(relPath, snapshot);

    const preview = buildDiffPreview(relPath, absPath, snapshot.before, after);
    return {
      path: absPath,
      relPath,
      status: snapshot.before === null ? 'added' : after === null ? 'deleted' : 'modified',
      additions: preview.additions,
      deletions: preview.deletions,
      revertable: true,
    };
  }

  getPreview(sessionId: string, relPath: string): DiffPreview | null {
    const snapshot = this.#bySession.get(sessionId)?.get(relPath);
    if (!snapshot) return null;
    return buildDiffPreview(relPath, snapshot.absPath, snapshot.before, snapshot.after);
  }

  listChanges(sessionId: string): FileChangeSummary[] {
    const map = this.#bySession.get(sessionId);
    if (!map) return [];
    return [...map.values()].map((snapshot) => {
      const preview = buildDiffPreview(snapshot.relPath, snapshot.absPath, snapshot.before, snapshot.after);
      return {
        path: snapshot.absPath,
        relPath: snapshot.relPath,
        status:
          snapshot.before === null ? ('added' as const) : snapshot.after === null ? ('deleted' as const) : ('modified' as const),
        additions: preview.additions,
        deletions: preview.deletions,
        revertable: true,
      };
    });
  }

  isRevertable(sessionId: string, relPath: string): boolean {
    return this.#bySession.get(sessionId)?.has(relPath) ?? false;
  }

  /** Restore the content captured before the first change of this session. */
  async revert(sessionId: string, relPath: string): Promise<void> {
    const snapshot = this.#bySession.get(sessionId)?.get(relPath);
    if (!snapshot) {
      throw new Error('이 파일의 변경 전 내용을 앱이 가지고 있지 않아 되돌릴 수 없습니다.');
    }
    if (snapshot.before === null) {
      await unlink(snapshot.absPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    } else {
      await mkdir(path.dirname(snapshot.absPath), { recursive: true });
      await writeFile(snapshot.absPath, snapshot.before, 'utf8');
    }
    this.#bySession.get(sessionId)?.delete(relPath);
    logger.info('변경을 되돌렸습니다.', { sessionId, relPath });
  }

  clearSession(sessionId: string): void {
    this.#bySession.delete(sessionId);
  }
}

/**
 * Files the CLI changed through its own tools (not via fs/write_text_file) still
 * show up here, as long as the workspace is a Git repository.
 */
export async function collectGitChanges(
  canonicalRoot: string,
): Promise<{ relPath: string; status: FileChangeSummary['status'] }[]> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '--no-renames'], {
      cwd: canonicalRoot,
      timeout: 5_000,
      env: sanitizeEnvironment(process.env),
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const code = line.slice(0, 2);
        const relPath = parsePorcelainPath(line);
        const status: FileChangeSummary['status'] = code.includes('D')
          ? 'deleted'
          : code.includes('?') || code.includes('A')
            ? 'added'
            : 'modified';
        return { relPath, status };
      });
  } catch {
    return [];
  }
}

/** Decode a `git status --porcelain=v1` path, including C-quoted names. */
export function parsePorcelainPath(line: string): string {
  if (line.length < 4) return '';
  const trimmed = line.slice(3).trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return unquoteGitCString(trimmed.slice(1, -1));
  }
  return trimmed;
}

function unquoteGitCString(inner: string): string {
  return inner.replace(/\\([abfnrtv\\"]|[0-7]{1,3})/g, (_match, cap: string) => {
    const named: Record<string, string> = {
      a: '\x07',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      '\\': '\\',
      '"': '"',
    };
    if (cap in named) return named[cap] ?? cap;
    return String.fromCharCode(Number.parseInt(cap, 8));
  });
}

export type GitDiffScope = 'working' | 'staged' | 'branch';

export async function gitCurrentBranch(canonicalRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: canonicalRoot,
      timeout: 3_000,
      env: sanitizeEnvironment(process.env),
    });
    const name = stdout.trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

async function gitBaseBranch(canonicalRoot: string): Promise<string> {
  for (const name of ['main', 'master']) {
    try {
      await execFileAsync('git', ['rev-parse', '--verify', name], {
        cwd: canonicalRoot,
        timeout: 3_000,
        env: sanitizeEnvironment(process.env),
      });
      return name;
    } catch {
      // try the next name
    }
  }
  return 'HEAD';
}

function gitDiffArgs(scope: GitDiffScope, base: string, relPath?: string): string[] {
  const pathArgs = relPath ? ['--', relPath] : [];
  if (scope === 'staged') return ['diff', '--no-color', '--cached', ...pathArgs];
  if (scope === 'branch') return ['diff', '--no-color', `${base}...HEAD`, ...pathArgs];
  return ['diff', '--no-color', ...pathArgs];
}

/** Unified diff straight from Git, used when the app has no snapshot. */
export async function gitDiffFile(
  canonicalRoot: string,
  relPath: string,
  scope: GitDiffScope = 'working',
): Promise<string | null> {
  try {
    const base = scope === 'branch' ? await gitBaseBranch(canonicalRoot) : 'HEAD';
    const { stdout } = await execFileAsync('git', gitDiffArgs(scope, base, relPath), {
      cwd: canonicalRoot,
      timeout: 5_000,
      env: sanitizeEnvironment(process.env),
      maxBuffer: MAX_INLINE_FILE_BYTES * 4,
    });
    return stdout.trim().length > 0 ? maskSecrets(stdout) : null;
  } catch {
    return null;
  }
}

export async function collectGitChangesForScope(
  canonicalRoot: string,
  scope: GitDiffScope,
): Promise<{ relPath: string; status: FileChangeSummary['status'] }[]> {
  try {
    if (scope === 'working' || scope === 'staged') {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '--no-renames'], {
        cwd: canonicalRoot,
        timeout: 5_000,
        env: sanitizeEnvironment(process.env),
        maxBuffer: 4 * 1024 * 1024,
      });
      return stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .flatMap((line) => {
          const code = line.slice(0, 2);
          const relPath = parsePorcelainPath(line);
          const index = code[0] ?? ' ';
          const work = code[1] ?? ' ';
          const wanted = scope === 'staged' ? index : work === ' ' ? index : work;
          if (scope === 'staged' && (index === ' ' || index === '?')) return [];
          if (scope === 'working' && work === ' ' && index !== '?') return [];
          const status: FileChangeSummary['status'] =
            wanted === 'D' ? 'deleted' : wanted === '?' || wanted === 'A' ? 'added' : 'modified';
          return [{ relPath, status }];
        });
    }

    const base = await gitBaseBranch(canonicalRoot);
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-status', '--no-renames', `${base}...HEAD`],
      {
        cwd: canonicalRoot,
        timeout: 5_000,
        env: sanitizeEnvironment(process.env),
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    return stdout
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const [code, ...rest] = line.split('\t');
        const relPath = rest.join('\t').trim();
        const status: FileChangeSummary['status'] =
          code === 'D' ? 'deleted' : code === 'A' ? 'added' : 'modified';
        return { relPath, status };
      });
  } catch {
    return [];
  }
}

export type DiffHunk = {
  header: string;
  patch: string;
};

export function parseDiffHunks(unifiedDiff: string): DiffHunk[] {
  const lines = unifiedDiff.split('\n');
  const preamble: string[] = [];
  const hunks: DiffHunk[] = [];
  let current: string[] = [];
  let header = '';
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current.length > 0) hunks.push({ header, patch: [...preamble, ...current].join('\n') + '\n' });
      header = line;
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current.length > 0) hunks.push({ header, patch: [...preamble, ...current].join('\n') + '\n' });
  return hunks;
}

export async function applyGitHunk(
  canonicalRoot: string,
  hunkPatch: string,
  action: 'stage' | 'unstage' | 'revert',
): Promise<void> {
  const args = ['apply', '--recount', '--whitespace=nowarn'];
  if (action === 'stage') args.push('--cached');
  if (action === 'unstage') args.push('--cached', '--reverse');
  if (action === 'revert') args.push('--reverse');
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd: canonicalRoot, timeout: 8_000, env: sanitizeEnvironment(process.env) },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
    child.stdin?.end(hunkPatch);
  });
}

export async function gitPush(canonicalRoot: string): Promise<string> {
  const branch = (await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: canonicalRoot,
    timeout: 5_000,
    env: sanitizeEnvironment(process.env),
  })).stdout.trim();
  if (!branch || branch === 'HEAD') throw new Error('분리된 HEAD에서는 푸시하지 않습니다.');
  try {
    await execFileAsync('git', ['push', '-u', 'origin', 'HEAD'], {
      cwd: canonicalRoot,
      timeout: 60_000,
      env: sanitizeEnvironment(process.env),
    });
  } catch {
    throw new Error('origin으로 푸시하지 못했습니다. 원격과 권한이 있는지 확인하세요.');
  }
  return `${branch} 브랜치를 origin에 올렸습니다.`;
}

export async function gitCreatePr(canonicalRoot: string, title: string, body: string): Promise<string> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('PR 제목이 비어 있습니다.');
  await gitPush(canonicalRoot);
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'create', '--title', trimmed, '--body', body.trim() || trimmed],
      {
        cwd: canonicalRoot,
        timeout: 60_000,
        env: sanitizeEnvironment(process.env),
      },
    );
    return stdout.trim() || 'PR을 만들었습니다.';
  } catch {
    throw new Error('PR을 만들지 못했습니다. GitHub CLI(gh) 로그인과 권한을 확인하세요.');
  }
}

export async function gitCommit(canonicalRoot: string, message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) throw new Error('커밋 메시지가 비어 있습니다.');
  try {
    await execFileAsync('git', ['commit', '-m', trimmed], {
      cwd: canonicalRoot,
      timeout: 15_000,
      env: sanitizeEnvironment(process.env),
    });
  } catch {
    throw new Error('Git 커밋에 실패했습니다. 스테이징된 변경이 있는지 확인하세요.');
  }
}

export async function gitStageFile(canonicalRoot: string, relPath: string, stage: boolean): Promise<void> {
  await execFileAsync('git', stage ? ['add', '--', relPath] : ['restore', '--staged', '--', relPath], {
    cwd: canonicalRoot,
    timeout: 5_000,
    env: sanitizeEnvironment(process.env),
  });
}

export async function gitRestoreFile(
  canonicalRoot: string,
  relPath: string,
  scope: GitDiffScope,
): Promise<boolean> {
  if (scope === 'branch') return false;
  try {
    const args = scope === 'staged' ? ['restore', '--staged', '--worktree', '--', relPath] : ['restore', '--', relPath];
    await execFileAsync('git', args, {
      cwd: canonicalRoot,
      timeout: 5_000,
      env: sanitizeEnvironment(process.env),
    });
    return true;
  } catch {
    return false;
  }
}
