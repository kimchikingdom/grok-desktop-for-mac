import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { applyWorktreeToMain, createSessionWorktree } from './worktrees.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

describe('applyWorktreeToMain', () => {
  let dir = '';

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('applies tracked diffs and copies untracked files into the main tree', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'grok-wt-'));
    const root = path.join(dir, 'repo');
    await mkdir(root);
    await git(root, ['init', '-b', 'main']);
    await writeFile(path.join(root, 'tracked.txt'), 'base\n');
    await git(root, ['add', 'tracked.txt']);
    await git(root, ['commit', '-m', 'init']);

    const worktree = await createSessionWorktree(root, path.join(dir, 'home'));
    await writeFile(path.join(worktree.cwd, 'tracked.txt'), 'changed\n');
    await mkdir(path.join(worktree.cwd, 'nested'), { recursive: true });
    await writeFile(path.join(worktree.cwd, 'nested', 'fresh.txt'), 'new file\n');

    const applied = await applyWorktreeToMain(root, worktree.cwd);
    expect(applied).toBe(1);
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('changed\n');
    expect(await readFile(path.join(root, 'nested', 'fresh.txt'), 'utf8')).toBe('new file\n');
  });
});
