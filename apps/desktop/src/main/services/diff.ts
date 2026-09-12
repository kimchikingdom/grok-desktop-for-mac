import { execFile } from 'node:child_process';
import { readFile, writeFile, unlink, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createTwoFilesPatch } from 'diff';
import { MAX_INLINE_FILE_BYTES, looksBinary, maskSecrets, resolveWithinRoot, sanitizeEnvironment } from '@grok-desktop/security';
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

const NAMED_ESCAPE_BYTES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  '\\': 0x5c,
  '"': 0x22,
};

/**
 * Git escapes a non-ASCII name one octal escape per UTF-8 byte, so the escapes
 * have to be gathered and decoded together: decoding them one at a time turns a
 * Korean file name into mojibake and the path then matches nothing on disk.
 */
function unquoteGitCString(inner: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index] ?? '';
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'));
      continue;
    }
    const escaped = inner[index + 1] ?? '';
    const named = NAMED_ESCAPE_BYTES[escaped];
    if (named !== undefined) {
      bytes.push(named);
      index += 1;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(inner.slice(index + 1, index + 4))?.[0];
    if (octal === undefined) {
      bytes.push(0x5c); // a lone backslash Git did not escape
      continue;
    }
    bytes.push(Number.parseInt(octal, 8) & 0xff);
    index += octal.length;
  }
  return Buffer.from(bytes).toString('utf8');
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

/** `git diff` ignores untracked files, so a new file is diffed against the null device. */
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

/**
 * `--no-index` writes the null device into the headers. Name both sides after
 * the file itself so the patch reads like any other new-file diff.
 */
export function normalizeUntrackedPatch(patch: string, relPath: string): string {
  return patch
    .split('\n')
    .map((line) => {
      if (line.startsWith('diff --git ')) return `diff --git a/${relPath} b/${relPath}`;
      if (line.startsWith('--- ')) return '--- /dev/null';
      if (line.startsWith('+++ ')) return `+++ b/${relPath}`;
      return line;
    })
    .join('\n');
}

async function gitUntrackedDiff(canonicalRoot: string, relPath: string): Promise<string | null> {
  const options = {
    cwd: canonicalRoot,
    timeout: 5_000,
    env: sanitizeEnvironment(process.env),
    maxBuffer: MAX_INLINE_FILE_BYTES * 4,
  };
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain=v1', '--no-renames', '--', relPath],
      options,
    );
    if (!stdout.startsWith('??')) return null;
  } catch {
    return null;
  }
  try {
    // `--no-index` exits 1 whenever the two sides differ, which is always here.
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--no-color', '--no-index', '--', NULL_DEVICE, relPath],
      options,
    );
    return stdout.trim().length > 0 ? maskSecrets(normalizeUntrackedPatch(stdout, relPath)) : null;
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout ?? '';
    return stdout.trim().length > 0 ? maskSecrets(normalizeUntrackedPatch(stdout, relPath)) : null;
  }
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
    if (stdout.trim().length > 0) return maskSecrets(stdout);
  } catch {
    return null;
  }
  // Nothing tracked changed: the file may simply be new to the repository.
  return scope === 'working' ? gitUntrackedDiff(canonicalRoot, relPath) : null;
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

export type DiffLineCounts = { additions: number; deletions: number };

/** Untracked files are read one by one, so only this many are counted per list. */
const MAX_UNTRACKED_STAT_FILES = 100;

/**
 * Parse `git diff --numstat -z` into counts keyed by repository-relative path.
 * `-z` is what keeps Korean and spaced paths readable: without it Git honours
 * core.quotePath and hands back a C-quoted, escaped name instead.
 */
export function parseNumstat(stdout: string): Map<string, DiffLineCounts> {
  const counts = new Map<string, DiffLineCounts>();
  for (const record of stdout.split('\0')) {
    if (record.length === 0) continue;
    const firstTab = record.indexOf('\t');
    const secondTab = record.indexOf('\t', firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const relPath = record.slice(secondTab + 1);
    if (relPath.length === 0) continue;
    // Binary files report `-` for both columns; count them as zero line changes.
    const additions = Number.parseInt(record.slice(0, firstTab), 10);
    const deletions = Number.parseInt(record.slice(firstTab + 1, secondTab), 10);
    counts.set(relPath, {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
    });
  }
  return counts;
}

/** Lines in a file the way Git counts them: a trailing newline ends a line. */
function countTextLines(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

async function runNumstat(canonicalRoot: string, scope: GitDiffScope): Promise<Map<string, DiffLineCounts>> {
  try {
    const range = scope === 'branch' ? [`${await gitBaseBranch(canonicalRoot)}...HEAD`] : [];
    const cached = scope === 'staged' ? ['--cached'] : [];
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--numstat', '-z', '--no-renames', ...cached, ...range],
      {
        cwd: canonicalRoot,
        timeout: 5_000,
        env: sanitizeEnvironment(process.env),
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    return parseNumstat(stdout);
  } catch {
    return new Map();
  }
}

/**
 * Per-file additions/deletions for the review list, in one `git diff` per scope
 * rather than one per file.
 */
export async function collectDiffLineCounts(
  canonicalRoot: string,
  scope: GitDiffScope,
  entries: { relPath: string; status: FileChangeSummary['status'] }[],
): Promise<Map<string, DiffLineCounts>> {
  const counts = await runNumstat(canonicalRoot, scope);
  if (scope !== 'working') return counts;

  // `git diff` never reports untracked files, so their additions come from the
  // file itself. Reading is bounded on purpose — a list can hold a whole
  // untracked build output tree — so beyond the cap the rows stay at 0 rather
  // than making the panel wait on disk.
  let read = 0;
  for (const entry of entries) {
    if (read >= MAX_UNTRACKED_STAT_FILES) break;
    if (entry.status !== 'added' || counts.has(entry.relPath)) continue;
    if (looksBinary(entry.relPath)) continue;
    const absPath = path.join(canonicalRoot, entry.relPath);
    try {
      const info = await stat(absPath);
      // Porcelain collapses a whole untracked directory into one entry, so the
      // path here is not always a file.
      if (!info.isFile() || info.size > MAX_INLINE_FILE_BYTES) continue;
      read += 1;
      counts.set(entry.relPath, { additions: countTextLines(await readFile(absPath, 'utf8')), deletions: 0 });
    } catch {
      // Gone or unreadable between listing and counting: leave the row at 0.
    }
  }
  return counts;
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

/**
 * Every workspace path a patch names. `git apply` reads the file names out of
 * the patch itself, so the caller has to contain these, not just the relPath it
 * thinks it is patching.
 */
export function pathsInPatch(patch: string): string[] {
  const found = new Set<string>();
  for (const line of patch.split('\n')) {
    const gitHeader = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (gitHeader) {
      if (gitHeader[1]) found.add(gitHeader[1]);
      if (gitHeader[2]) found.add(gitHeader[2]);
      continue;
    }
    const fileHeader = /^(?:---|\+\+\+) (.+?)(?:\t.*)?$/.exec(line);
    if (!fileHeader) continue;
    const raw = fileHeader[1];
    if (!raw || raw === '/dev/null') continue;
    found.add(raw.replace(/^[ab]\//, ''));
  }
  return [...found];
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
  // Git resolves a path against the repository, not the cwd, so a workspace that
  // sits inside a larger repo could otherwise have files above it restored.
  // The caller contains the path too; this is the layer that cannot be skipped.
  try {
    await resolveWithinRoot(canonicalRoot, relPath);
  } catch {
    logger.security('작업공간 밖 경로의 되돌리기를 거부했습니다.', { relPath });
    return false;
  }
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
