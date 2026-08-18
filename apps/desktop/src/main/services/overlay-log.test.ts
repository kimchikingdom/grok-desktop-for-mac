import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OverlayLog } from './overlay-log.js';

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('OverlayLog', () => {
  it('replays permission and file-changed events and ignores the rest', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'grok-overlay-'));
    temps.push(dir);
    const log = new OverlayLog(dir);
    await log.append('sess-1', {
      type: 'permission-resolved',
      sessionId: 'sess-1',
      requestId: 'p1',
      decision: 'approved-once',
    });
    await log.append('sess-1', {
      type: 'session-status',
      sessionId: 'sess-1',
      status: 'idle',
    });
    await log.append('sess-1', {
      type: 'file-changed',
      sessionId: 'sess-1',
      change: {
        path: '/tmp/a.ts',
        relPath: 'a.ts',
        status: 'modified',
        additions: 2,
        deletions: 0,
        revertable: false,
      },
    });

    const items = await log.apply('sess-1', [
      {
        kind: 'permission',
        id: 'p1',
        request: {
          id: 'p1',
          sessionId: 'sess-1',
          kind: 'edit',
          title: '쓰기',
          risk: 'medium',
          reasons: [],
          locations: [],
          options: [],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    ]);
    expect(items[0]).toMatchObject({ kind: 'permission', decision: 'approved-once' });

    await log.remove('sess-1');
    const after = await log.apply('sess-1', []);
    expect(after).toEqual([]);
  });

  it('drops permission events that rewind removed', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'grok-overlay-'));
    temps.push(dir);
    const log = new OverlayLog(dir);
    await log.append('sess-1', {
      type: 'permission-request',
      sessionId: 'sess-1',
      request: {
        id: 'old',
        sessionId: 'sess-1',
        kind: 'edit',
        title: '쓰기',
        risk: 'medium',
        reasons: [],
        locations: [],
        options: [],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    await log.append('sess-1', {
      type: 'permission-request',
      sessionId: 'sess-1',
      request: {
        id: 'keep',
        sessionId: 'sess-1',
        kind: 'edit',
        title: '쓰기',
        risk: 'medium',
        reasons: [],
        locations: [],
        options: [],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    await log.prune('sess-1', [
      {
        kind: 'permission',
        id: 'keep',
        request: {
          id: 'keep',
          sessionId: 'sess-1',
          kind: 'edit',
          title: '쓰기',
          risk: 'medium',
          reasons: [],
          locations: [],
          options: [],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    ]);
    const items = await log.apply('sess-1', []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'keep' });
  });
});
