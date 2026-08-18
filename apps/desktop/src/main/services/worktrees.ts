import { randomUUID } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { canonicalize, resolveWithinRoot, sanitizeEnvironment } from '@grok-desktop/security';
import { grokHome } from './cli-sessions.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export type SessionWorktree = {
  cwd: string;
  label: string;
};

async function git(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, {
    cwd,
    timeout: 30_000,
    env: sanitizeEnvironment(process.env),
    maxBuffer: 4 * 1024 * 1024,
  });
}

export async function gitRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await git(cwd, ['rev-parse', '--show-toplevel']);
    const root = stdout.trim();
    return root || null;
  } catch {
    return null;
  }
}

/**
 * Isolated checkout for a parallel session. Lives under GROK_HOME/worktrees
 * so two sessions never share a working tree.
 */
export async function createSessionWorktree(
  repoPath: string,
  grokHomeDir = grokHome(),
): Promise<SessionWorktree> {
  const root = await gitRoot(repoPath);
  if (!root) throw new Error('Git 저장소가 아니라 워크트리를 만들 수 없습니다.');

  const label = `grok-${randomUUID().slice(0, 8)}`;
  const slug = encodeURIComponent(root).slice(0, 80);
  const dest = path.join(grokHomeDir, 'worktrees', slug, label);
  await mkdir(path.dirname(dest), { recursive: true });
  await git(root, ['worktree', 'add', '--detach', dest]);
  logger.info('세션 워크트리를 만들었습니다.', { root, dest, label });
  return { cwd: dest, label };
}

export async function applyWorktreeToMain(repoPath: string, worktreeCwd: string): Promise<number> {
  const root = (await gitRoot(repoPath)) ?? repoPath;
  const { stdout } = await git(worktreeCwd, ['diff', '--binary', 'HEAD']);
  const { stdout: untracked } = await git(worktreeCwd, ['ls-files', '--others', '--exclude-standard']);
  if (!stdout.trim() && !untracked.trim()) return 0;
  if (stdout.trim()) {
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        'git',
        ['apply', '--3way', '--whitespace=nowarn'],
        { cwd: root, timeout: 30_000, env: sanitizeEnvironment(process.env) },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
      child.stdin?.end(stdout);
    });
  }
  const worktreeRoot = await canonicalize(worktreeCwd);
  const mainRoot = await canonicalize(root);
  for (const rel of untracked.split('\n').map((line) => line.trim()).filter(Boolean)) {
    try {
      const source = await resolveWithinRoot(worktreeRoot, rel);
      const dest = await resolveWithinRoot(mainRoot, rel);
      await mkdir(path.dirname(dest.canonicalPath), { recursive: true });
      await copyFile(source.canonicalPath, dest.canonicalPath);
    } catch (error) {
      logger.warn('워크트리의 미추적 파일을 복사하지 못했습니다.', { rel, reason: String(error) });
    }
  }
  return 1;
}

export async function removeSessionWorktree(repoPath: string, worktreeCwd: string): Promise<void> {
  const root = (await gitRoot(repoPath)) ?? repoPath;
  try {
    await git(root, ['worktree', 'remove', '--force', worktreeCwd]);
  } catch (error) {
    logger.warn('워크트리를 제거하지 못했습니다.', { worktreeCwd, reason: String(error) });
  }
}
