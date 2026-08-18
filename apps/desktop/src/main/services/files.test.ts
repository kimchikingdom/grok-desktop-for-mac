import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalize } from '@grok-desktop/security';
import { readWorkspaceFile, writeInboxImage } from './files.js';

describe('readWorkspaceFile', () => {
  let dir = '';

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('marks previews that had secrets redacted so save can refuse them', async () => {
    dir = await canonicalize(await mkdtemp(path.join(os.tmpdir(), 'grok-file-')));
    await writeFile(path.join(dir, 'notes.md'), 'token xai-abcdefghijklmnopqrstuvwxyz0123\nhello\n');
    const file = await readWorkspaceFile(dir, 'notes.md');
    expect(file.masked).toBe(true);
    expect(file.text).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(file.truncated).toBe(false);
  });

  it('does not mark ordinary files as masked', async () => {
    dir = await canonicalize(await mkdtemp(path.join(os.tmpdir(), 'grok-file-')));
    await writeFile(path.join(dir, 'readme.md'), 'hello world\n');
    const file = await readWorkspaceFile(dir, 'readme.md');
    expect(file.masked).toBe(false);
    expect(file.text).toContain('hello world');
  });
});

describe('writeInboxImage', () => {
  let dir = '';

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('writes a pasted png under desktop-inbox and rejects other types', async () => {
    dir = await canonicalize(await mkdtemp(path.join(os.tmpdir(), 'grok-inbox-')));
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const rel = await writeInboxImage(dir, 'image/png', png);
    expect(rel.startsWith('desktop-inbox/paste-')).toBe(true);
    expect(rel.endsWith('.png')).toBe(true);
    expect(await readFile(path.join(dir, 'desktop-inbox', '.gitignore'), 'utf8')).toBe('*\n');
    await expect(writeInboxImage(dir, 'application/pdf', png)).rejects.toThrow(/이미지/);
  });
});
