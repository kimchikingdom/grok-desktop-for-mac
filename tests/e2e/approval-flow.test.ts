import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalize } from '@grok-desktop/security';
import type { PermissionRequestView, SessionEvent, WorkspaceRecord } from '@grok-desktop/shared';
import { ChangeTracker } from '../../apps/desktop/src/main/services/diff.js';
import { SessionManager } from '../../apps/desktop/src/main/services/session-manager.js';
import { MetadataStore } from '../../apps/desktop/src/main/services/store.js';
import { TranscriptStore } from '../../apps/desktop/src/main/services/transcript.js';

const FAKE_AGENT = fileURLToPath(new URL('../fixtures/fake-agent.mjs', import.meta.url));

let root: string;
let workspace: WorkspaceRecord;
let store: MetadataStore;
let changes: ChangeTracker;
let sessions: SessionManager;
let events: SessionEvent[];

async function startSession(scenario: string, mode: 'ask' | 'agent' = 'agent') {
  return sessions.create({
    workspace,
    mode,
    binaryPath: process.execPath,
    args: [FAKE_AGENT, scenario],
  });
}

function findRequest(): PermissionRequestView | undefined {
  const event = events.find((entry) => entry.type === 'permission-request');
  return event?.type === 'permission-request' ? event.request : undefined;
}

beforeEach(async () => {
  root = await canonicalize(await mkdtemp(path.join(os.tmpdir(), 'grok-approval-')));
  await writeFile(path.join(root, 'README.md'), 'hello\n');
  await writeFile(path.join(root, '..', 'outside-secret.txt'), 'top secret\n').catch(() => undefined);

  store = new MetadataStore(path.join(root, '.grok-desktop', 'metadata.json'));
  await store.load();
  workspace = store.upsertWorkspace({
    rootPath: root,
    canonicalRootPath: root,
    displayName: path.basename(root),
    permissionProfile: 'ask',
  });

  changes = new ChangeTracker();
  events = [];
  const transcripts = new TranscriptStore(path.join(root, '.grok-desktop', 'sessions'));
  sessions = new SessionManager(store, changes, (event) => events.push(event), transcripts);
});

afterEach(async () => {
  await sessions.disposeAll();
  // Let the store's queued write settle, otherwise it can recreate a file
  // underneath the directory removal below.
  await store.flush();
  await rm(root, { recursive: true, force: true });
});

describe('approval round trip', () => {
  it('does not touch the file until the user approves, then writes it and reports a real diff', async () => {
    const session = await startSession('permission');
    const turn = sessions.prompt({ sessionId: session.id, text: 'README를 바꿔줘', attachments: [] });

    await vi.waitFor(() => expect(findRequest()).toBeDefined());
    const request = findRequest();

    // Still untouched while the approval card is open.
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe('hello\n');
    expect(request?.kind).toBe('edit');
    expect(request?.preview?.unifiedDiff).toContain('+hello world');
    expect(request?.options.map((option) => option.kind)).toContain('allow-once');

    await sessions.decide({
      sessionId: session.id,
      requestId: request!.id,
      optionId: 'once',
      scope: 'once',
    });
    await turn;

    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe('hello world\n');

    const changed = events.find((event) => event.type === 'file-changed');
    expect(changed?.type === 'file-changed' && changed.change.relPath).toBe('README.md');
    expect(changed?.type === 'file-changed' && changed.change.additions).toBeGreaterThan(0);

    const approvals = store.listApprovals(session.id);
    expect(approvals[0]?.decision).toBe('approved-once');
  });

  it('leaves the file alone when the user denies, and tells the agent', async () => {
    const session = await startSession('permission');
    const turn = sessions.prompt({ sessionId: session.id, text: 'README를 바꿔줘', attachments: [] });

    await vi.waitFor(() => expect(findRequest()).toBeDefined());
    await sessions.decide({
      sessionId: session.id,
      requestId: findRequest()!.id,
      optionId: 'deny',
      scope: 'deny',
    });
    await turn;

    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe('hello\n');
    const answer = events
      .filter((event) => event.type === 'message-delta')
      .map((event) => (event.type === 'message-delta' ? event.text : ''))
      .join('');
    expect(answer).toContain('거부');
    expect(store.listApprovals(session.id)[0]?.decision).toBe('denied');
  });

  it('blocks a read that points outside the workspace', async () => {
    const session = await startSession('escape');
    await sessions.prompt({ sessionId: session.id, text: '../outside-secret.txt 읽어줘', attachments: [] });

    const denial = events.find((event) => event.type === 'error' && event.code === 'path-escape');
    expect(denial).toBeDefined();

    const answer = events
      .filter((event) => event.type === 'message-delta')
      .map((event) => (event.type === 'message-delta' ? event.text : ''))
      .join('');
    expect(answer).not.toContain('탈출 성공');
  });

  it('refuses to write at all in Ask mode', async () => {
    const session = await startSession('permission', 'ask');
    const turn = sessions.prompt({ sessionId: session.id, text: 'README를 바꿔줘', attachments: [] });
    await turn;

    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe('hello\n');
    expect(findRequest()).toBeUndefined();
  });

  it('reuses a session-scoped grant for the same tool', async () => {
    const session = await startSession('permission');
    const first = sessions.prompt({ sessionId: session.id, text: '한 번 더 바꿔줘', attachments: [] });
    await vi.waitFor(() => expect(findRequest()).toBeDefined());
    await sessions.decide({
      sessionId: session.id,
      requestId: findRequest()!.id,
      optionId: 'session',
      scope: 'session',
    });
    await first;

    events = [];
    await sessions.prompt({ sessionId: session.id, text: '또 바꿔줘', attachments: [] });

    // The grant applies, so nothing blocks the turn. The app still records what
    // it auto-approved: a request with no options, resolved as 'auto-allowed'.
    const second = findRequest();
    expect(second?.options ?? []).toHaveLength(0);
    expect(
      events.some((event) => event.type === 'permission-resolved' && event.decision === 'auto-allowed'),
    ).toBe(true);
    expect(await readFile(path.join(root, 'README.md'), 'utf8')).toBe('hello world\n');
  });
});
