import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TranscriptStore } from './transcript.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'grok-transcript-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('TranscriptStore', () => {
  it('round-trips a cache and masks secrets on disk', async () => {
    const store = new TranscriptStore(dir);
    await store.save('s1', {
      version: 1,
      items: [
        { kind: 'user', id: 'u', text: 'token sk-abc123456789012345678901234567', at: '2026-01-01T00:00:00.000Z' },
      ],
      changes: [],
    });
    const loaded = await store.load('s1');
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0]?.kind === 'user' && loaded.items[0].text).not.toContain('sk-abc');
  });

  it('returns an empty cache when the file is missing', async () => {
    const store = new TranscriptStore(dir);
    await expect(store.load('missing')).resolves.toEqual({ version: 1, items: [], changes: [] });
  });
});
