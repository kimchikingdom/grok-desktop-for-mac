import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalize } from '@grok-desktop/security';
import type { SessionEvent, WorkspaceRecord } from '@grok-desktop/shared';
import { ChangeTracker } from '../../apps/desktop/src/main/services/diff.js';
import { SessionManager } from '../../apps/desktop/src/main/services/session-manager.js';
import { MetadataStore } from '../../apps/desktop/src/main/services/store.js';
import { TranscriptStore } from '../../apps/desktop/src/main/services/transcript.js';

const FAKE_AGENT = fileURLToPath(new URL('../fixtures/fake-agent.mjs', import.meta.url));

let root: string;
let workspace: WorkspaceRecord;
let store: MetadataStore;
let sessions: SessionManager;
let events: SessionEvent[];

function startArgs(scenario: string) {
  return { binaryPath: process.execPath, args: [FAKE_AGENT, scenario] };
}

beforeEach(async () => {
  root = await canonicalize(await mkdtemp(path.join(os.tmpdir(), 'grok-resume-')));
  await writeFile(path.join(root, 'README.md'), 'hello\n');
  store = new MetadataStore(path.join(root, '.grok-desktop', 'metadata.json'));
  await store.load();
  workspace = store.upsertWorkspace({
    rootPath: root,
    canonicalRootPath: root,
    displayName: path.basename(root),
    permissionProfile: 'ask',
  });
  events = [];
  sessions = new SessionManager(
    store,
    new ChangeTracker(),
    (event) => events.push(event),
    new TranscriptStore(path.join(root, '.grok-desktop', 'sessions')),
  );
});

afterEach(async () => {
  await sessions.disposeAll();
  await store.flush();
  await rm(root, { recursive: true, force: true });
});

describe('session resume', () => {
  it('restores the transcript and reloads the agent session when the CLI supports it', async () => {
    const created = await sessions.create({ workspace, mode: 'ask', ...startArgs('basic') });
    await sessions.prompt({ sessionId: created.id, text: '이 프로젝트 구조를 설명해줘', attachments: [] });
    await sessions.disposeAll();

    const opened = await sessions.resume({ sessionId: created.id, ...startArgs('basic') });
    expect(opened.agentContext).toBe('loaded');
    expect(opened.items.some((item) => item.kind === 'user' && item.text.includes('프로젝트'))).toBe(true);
    expect(opened.items.some((item) => item.kind === 'message' && item.text.includes('README.md'))).toBe(true);
    expect(store.getSession(created.id)?.title).toContain('프로젝트');
  });

  it('keeps the cached conversation when session/load is unavailable', async () => {
    const created = await sessions.create({ workspace, mode: 'ask', ...startArgs('no-load') });
    await sessions.prompt({ sessionId: created.id, text: '안녕', attachments: [] });
    await sessions.disposeAll();

    const opened = await sessions.resume({ sessionId: created.id, ...startArgs('no-load') });
    expect(opened.agentContext).toBe('fresh');
    expect(opened.items.some((item) => item.kind === 'user')).toBe(true);
  });

  it('falls back to a new agent session when load fails', async () => {
    const created = await sessions.create({ workspace, mode: 'ask', ...startArgs('basic') });
    await sessions.prompt({ sessionId: created.id, text: '안녕', attachments: [] });
    await sessions.disposeAll();

    const opened = await sessions.resume({ sessionId: created.id, ...startArgs('load-fail') });
    expect(opened.agentContext).toBe('fresh');
    expect(opened.items.some((item) => item.kind === 'message')).toBe(true);
    expect(sessions.isLive(created.id)).toBe(true);
  });

  it('keeps the previous live session when a new one is created', async () => {
    const first = await sessions.create({ workspace, mode: 'ask', ...startArgs('basic') });
    const second = await sessions.create({ workspace, mode: 'ask', ...startArgs('basic') });
    expect(sessions.isLive(first.id)).toBe(true);
    expect(sessions.isLive(second.id)).toBe(true);
  });

  it('renames a parked session', async () => {
    const created = await sessions.create({ workspace, mode: 'ask', ...startArgs('basic') });
    await sessions.disposeAll();
    const renamed = sessions.rename(created.id, 'README 정리');
    expect(renamed.title).toBe('README 정리');
    expect(store.getSession(created.id)?.title).toBe('README 정리');
  });
});
