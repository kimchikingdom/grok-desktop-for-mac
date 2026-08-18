import { realpath, stat, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class PathEscapeError extends Error {
  constructor(
    readonly attemptedPath: string,
    readonly root: string,
  ) {
    super(`Path is outside the workspace root: ${attemptedPath}`);
    this.name = 'PathEscapeError';
  }
}

/**
 * Resolve a path to its real location, following symlinks.
 *
 * Paths that do not exist yet (a file the agent is about to create) still get a
 * canonical answer: the deepest existing ancestor is resolved with realpath and
 * the remaining segments are appended. That closes the "write through a symlinked
 * parent directory" escape, which a plain path.resolve() would miss.
 */
export async function canonicalize(target: string): Promise<string> {
  const absolute = path.resolve(target);
  try {
    return await realpath(absolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    const realParent = await canonicalize(parent);
    return path.join(realParent, path.basename(absolute));
  }
}

/** Pure containment check on two already-canonical absolute paths. */
export function isWithinRoot(canonicalRoot: string, canonicalTarget: string): boolean {
  const root = path.resolve(canonicalRoot);
  const target = path.resolve(canonicalTarget);
  if (root === target) return true;
  const relative = path.relative(root, target);
  if (relative === '') return true;
  if (relative.startsWith('..')) return false;
  if (path.isAbsolute(relative)) return false;
  return true;
}

/**
 * Canonicalize `target` and assert it stays inside `canonicalRoot`.
 * Returns the canonical path plus the workspace-relative path for display.
 */
export async function resolveWithinRoot(
  canonicalRoot: string,
  target: string,
): Promise<{ canonicalPath: string; relPath: string }> {
  const canonicalPath = await canonicalize(
    path.isAbsolute(target) ? target : path.join(canonicalRoot, target),
  );
  if (!isWithinRoot(canonicalRoot, canonicalPath)) {
    throw new PathEscapeError(target, canonicalRoot);
  }
  const relative = path.relative(canonicalRoot, canonicalPath);
  return { canonicalPath, relPath: relative === '' ? '.' : relative };
}

/** Non-throwing variant used when merely labelling a path in the UI. */
export async function describePath(
  canonicalRoot: string,
  target: string,
): Promise<{ canonicalPath: string; relPath?: string; insideWorkspace: boolean }> {
  const canonicalPath = await canonicalize(
    path.isAbsolute(target) ? target : path.join(canonicalRoot, target),
  );
  const insideWorkspace = isWithinRoot(canonicalRoot, canonicalPath);
  if (!insideWorkspace) return { canonicalPath, insideWorkspace };
  const relative = path.relative(canonicalRoot, canonicalPath);
  return { canonicalPath, relPath: relative === '' ? '.' : relative, insideWorkspace };
}

export type RootVerdict = {
  verdict: 'ok' | 'warn' | 'blocked';
  reasons: string[];
};

const SYSTEM_ROOTS_POSIX = [
  '/System',
  '/Library',
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/var',
  '/private',
  '/opt',
  '/Applications',
  '/dev',
  '/proc',
];

const HOME_BLOCKED_SUFFIXES = [
  '.ssh',
  '.gnupg',
  '.aws',
  '.docker',
  '.kube',
  '.grok',
  '.config/grok',
  '.config/gcloud',
  '.gem/credentials',
  'Library',
  'Library/Keychains',
  'Library/Application Support/Google/Chrome',
  'Library/Application Support/Firefox',
  'Library/Safari',
  'Library/Containers',
  'Library/Cookies',
  'AppData',
];

const HOME_WARN_SUFFIXES = ['Desktop', 'Documents', 'Downloads', 'Movies', 'Music', 'Pictures'];

function normalizeForCompare(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSameOrInside(parent: string, child: string): boolean {
  return isWithinRoot(normalizeForCompare(parent), normalizeForCompare(child));
}

/**
 * Decide whether a folder may be opened as a workspace root (spec 6.2).
 * 'blocked' can never be opened; 'warn' needs an explicit user confirmation.
 */
export function classifyWorkspaceRoot(
  canonicalRoot: string,
  homeDir: string = os.homedir(),
): RootVerdict {
  const reasons: string[] = [];
  const root = path.resolve(canonicalRoot);
  const home = path.resolve(homeDir);

  if (root === path.parse(root).root) {
    return { verdict: 'blocked', reasons: ['파일시스템 루트 전체는 작업공간으로 열 수 없습니다.'] };
  }

  if (root === home) {
    return { verdict: 'blocked', reasons: ['사용자 홈 디렉터리 전체는 작업공간으로 열 수 없습니다.'] };
  }

  // macOS puts the per-user temp directory under /private/var, which the system
  // directory rule below would otherwise block. Temp folders are allowed but
  // always flagged, since work there is easy to lose.
  const tempDir = os.tmpdir();
  const insideTemp =
    isSameOrInside(tempDir, root) || isSameOrInside(path.join('/private', tempDir), root);

  if (insideTemp) {
    if (root === path.resolve(tempDir)) {
      return { verdict: 'blocked', reasons: ['임시 디렉터리 전체는 작업공간으로 열 수 없습니다.'] };
    }
    reasons.push('임시 디렉터리 안의 폴더입니다. 시스템이 언제든 삭제할 수 있습니다.');
  } else {
    const brewRoots = ['/opt/homebrew', '/opt/local'];
    const insideBrew = brewRoots.some((brew) => isSameOrInside(brew, root) && root !== path.resolve(brew));
    if (!insideBrew) {
      for (const systemRoot of SYSTEM_ROOTS_POSIX) {
        if (isSameOrInside(systemRoot, root)) {
          return { verdict: 'blocked', reasons: [`운영체제 시스템 디렉터리(${systemRoot})는 열 수 없습니다.`] };
        }
      }
    }
  }

  if (process.platform === 'win32') {
    const windowsBlocked = ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'];
    for (const blocked of windowsBlocked) {
      if (isSameOrInside(blocked, root)) {
        return { verdict: 'blocked', reasons: [`시스템 디렉터리(${blocked})는 열 수 없습니다.`] };
      }
    }
  }

  for (const suffix of HOME_BLOCKED_SUFFIXES) {
    if (isSameOrInside(path.join(home, suffix), root)) {
      return {
        verdict: 'blocked',
        reasons: [`자격 증명이나 브라우저 프로필이 있는 경로(~/${suffix})는 열 수 없습니다.`],
      };
    }
  }

  // A whole external volume is too broad, but a project on it is fine.
  const volumeMatch = /^\/Volumes\/[^/]+$/.exec(root);
  if (volumeMatch) {
    reasons.push('외장 디스크 전체 루트입니다. 프로젝트 폴더를 직접 선택하는 편이 안전합니다.');
  }

  for (const suffix of HOME_WARN_SUFFIXES) {
    if (root === path.resolve(path.join(home, suffix))) {
      reasons.push(`개인 문서가 많이 포함될 수 있는 폴더(~/${suffix})입니다.`);
    }
  }

  return { verdict: reasons.length > 0 ? 'warn' : 'ok', reasons };
}

/** Full inspection of a folder the user picked in the native dialog. */
export async function inspectWorkspaceRoot(
  selectedPath: string,
  homeDir: string = os.homedir(),
): Promise<{ canonicalRoot: string } & RootVerdict> {
  const canonicalRoot = await canonicalize(selectedPath);
  const info = await stat(canonicalRoot);
  if (!info.isDirectory()) {
    return { canonicalRoot, verdict: 'blocked', reasons: ['선택한 경로가 디렉터리가 아닙니다.'] };
  }

  const classification = classifyWorkspaceRoot(canonicalRoot, homeDir);
  const reasons = [...classification.reasons];

  const link = await lstat(path.resolve(selectedPath)).catch(() => null);
  if (link?.isSymbolicLink() && classification.verdict !== 'blocked') {
    reasons.push(`선택한 경로는 심볼릭 링크이며 실제 위치는 ${canonicalRoot} 입니다.`);
    return { canonicalRoot, verdict: 'warn', reasons };
  }

  return { canonicalRoot, verdict: classification.verdict, reasons };
}
