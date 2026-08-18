import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PathEscapeError,
  canonicalize,
  classifyWorkspaceRoot,
  inspectWorkspaceRoot,
  isWithinRoot,
  resolveWithinRoot,
} from '@grok-desktop/security';

let root: string;
let workspace: string;
let outside: string;

beforeAll(async () => {
  root = await canonicalize(await mkdtemp(path.join(os.tmpdir(), 'grok-desktop-test-')));
  workspace = path.join(root, 'workspace');
  outside = path.join(root, 'outside');
  await mkdir(path.join(workspace, 'src'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(workspace, 'src', 'index.ts'), 'export const a = 1;\n');
  await writeFile(path.join(outside, 'secret.txt'), 'top secret\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('workspace containment', () => {
  it('resolves a file inside the root', async () => {
    const result = await resolveWithinRoot(workspace, 'src/index.ts');
    expect(result.relPath).toBe(path.join('src', 'index.ts'));
  });

  it('rejects ../ traversal', async () => {
    await expect(resolveWithinRoot(workspace, '../outside/secret.txt')).rejects.toBeInstanceOf(
      PathEscapeError,
    );
  });

  it('rejects an absolute path outside the root', async () => {
    await expect(resolveWithinRoot(workspace, '/etc/hosts')).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('rejects a symlink that points outside the root', async () => {
    const link = path.join(workspace, 'escape.txt');
    await symlink(path.join(outside, 'secret.txt'), link);
    await expect(resolveWithinRoot(workspace, 'escape.txt')).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('rejects a write through a symlinked directory, even for a file that does not exist yet', async () => {
    const linkedDir = path.join(workspace, 'linkdir');
    await symlink(outside, linkedDir);
    await expect(resolveWithinRoot(workspace, 'linkdir/new-file.txt')).rejects.toBeInstanceOf(
      PathEscapeError,
    );
  });

  it('allows a not-yet-existing file inside the root', async () => {
    const result = await resolveWithinRoot(workspace, 'src/new/deep/file.ts');
    expect(result.canonicalPath.startsWith(workspace)).toBe(true);
  });

  it('does not treat a sibling directory with a shared prefix as inside', () => {
    expect(isWithinRoot('/a/project', '/a/project-2/file.ts')).toBe(false);
    expect(isWithinRoot('/a/project', '/a/project/file.ts')).toBe(true);
  });
});

describe('workspace root policy', () => {
  it('blocks the filesystem root and the home directory', () => {
    expect(classifyWorkspaceRoot('/', '/Users/tester').verdict).toBe('blocked');
    expect(classifyWorkspaceRoot('/Users/tester', '/Users/tester').verdict).toBe('blocked');
  });

  it('blocks system and credential directories', () => {
    for (const candidate of [
      '/System/Library',
      '/usr/local',
      '/etc',
      '/Users/tester/.ssh',
      '/Users/tester/.grok',
      '/Users/tester/.config/grok',
      '/Users/tester/Library/Keychains',
    ]) {
      expect(classifyWorkspaceRoot(candidate, '/Users/tester').verdict).toBe('blocked');
    }
  });

  it('warns on broad personal folders and volume roots', () => {
    expect(classifyWorkspaceRoot('/Users/tester/Documents', '/Users/tester').verdict).toBe('warn');
    expect(classifyWorkspaceRoot('/Volumes/Backup', '/Users/tester').verdict).toBe('warn');
  });

  it('accepts an ordinary project folder', () => {
    expect(classifyWorkspaceRoot('/Users/tester/code/my-app', '/Users/tester').verdict).toBe('ok');
  });

  it('warns for a project inside the temp directory instead of blocking it', async () => {
    const result = await inspectWorkspaceRoot(workspace, path.join(root, 'home'));
    expect(result.verdict).toBe('warn');
    expect(result.reasons.join(' ')).toContain('임시 디렉터리');
  });

  it('warns when the selected folder is itself a symlink', async () => {
    const linked = path.join(root, 'linked-workspace');
    await symlink(workspace, linked);
    const result = await inspectWorkspaceRoot(linked, path.join(root, 'home'));
    expect(result.verdict).toBe('warn');
    expect(result.canonicalRoot).toBe(workspace);
  });
});
