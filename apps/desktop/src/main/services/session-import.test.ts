import { mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChangeTracker } from './diff.js';
import { encodeWorkspaceKey } from './cli-sessions.js';
import { SessionManager } from './session-manager.js';
import { MetadataStore } from './store.js';
import { TranscriptStore } from './transcript.js';
import { OverlayLog } from './overlay-log.js';

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('CLI session import / delete', () => {
  it('indexes a CLI session and deletes both the app record and the CLI directory', async () => {
    const root = path.join(os.tmpdir(), `grok-import-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    temps.push(root);
    const cwd = path.join(root, 'proj');
    const grokHome = path.join(root, 'grok-home');
    const sessionDir = path.join(grokHome, 'sessions', encodeWorkspaceKey(cwd), 'cli-sess-1');
    await mkdir(cwd, { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      path.join(sessionDir, 'summary.json'),
      JSON.stringify({
        info: { id: 'cli-sess-1', cwd },
        generated_title: 'CLI에서 온 대화',
        last_active_at: '2026-08-02T00:00:00.000Z',
        created_at: '2026-08-01T00:00:00.000Z',
      }),
    );
    await writeFile(
      path.join(sessionDir, 'updates.jsonl'),
      `${JSON.stringify({
        timestamp: 1_786_705_000,
        method: 'session/update',
        params: { update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '안녕' } } },
      })}\n`,
    );

    const store = new MetadataStore(path.join(root, 'metadata.json'));
    await store.load();
    const workspace = store.upsertWorkspace({
      rootPath: cwd,
      canonicalRootPath: cwd,
      displayName: 'proj',
      permissionProfile: 'ask',
    });
    const overlays = new OverlayLog(path.join(root, 'overlays'));
    const sessions = new SessionManager(
      store,
      new ChangeTracker(),
      () => undefined,
      new TranscriptStore(path.join(root, 'sessions')),
      undefined,
      overlays,
      grokHome,
    );

    const listed = await sessions.importCliSessions(workspace);
    expect(listed.map((entry) => entry.id)).toEqual(['cli-sess-1']);
    const record = store.findSessionByGrokId('cli-sess-1');
    expect(record?.title).toBe('CLI에서 온 대화');

    await sessions.delete(record!.id);
    expect(store.findSessionByGrokId('cli-sess-1')).toBeUndefined();
    const leftover = await sessions.importCliSessions(workspace);
    expect(leftover).toEqual([]);
  });
});
