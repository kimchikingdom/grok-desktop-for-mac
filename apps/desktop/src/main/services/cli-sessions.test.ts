import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeWorkspaceKey, listCliSessions, replayCliTranscript, stripComposerDecorations } from './cli-sessions.js';

const temps: string[] = [];

async function makeHome(): Promise<string> {
  const dir = path.join(os.tmpdir(), `grok-cli-sess-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('stripComposerDecorations', () => {
  it('removes the app mode prefix', () => {
    expect(stripComposerDecorations('[모드: Agent] 승인하라.\n\n파일 고쳐줘')).toBe('파일 고쳐줘');
  });
});

describe('listCliSessions + replay', () => {
  it('finds main sessions for a cwd and hides subagents', async () => {
    const home = await makeHome();
    const cwd = '/Users/me/proj';
    const group = path.join(home, 'sessions', encodeWorkspaceKey(cwd));
    const mainDir = path.join(group, 'sess-main');
    const subDir = path.join(group, 'sess-sub');
    await mkdir(mainDir, { recursive: true });
    await mkdir(subDir, { recursive: true });
    await writeFile(
      path.join(mainDir, 'summary.json'),
      JSON.stringify({
        info: { id: 'sess-main', cwd },
        generated_title: 'README 고치기',
        created_at: '2026-08-01T00:00:00.000Z',
        last_active_at: '2026-08-02T00:00:00.000Z',
        num_messages: 2,
      }),
    );
    await writeFile(
      path.join(subDir, 'summary.json'),
      JSON.stringify({
        info: { id: 'sess-sub', cwd },
        generated_title: 'explore',
        session_kind: 'subagent',
        last_active_at: '2026-08-03T00:00:00.000Z',
      }),
    );
    const listed = await listCliSessions(cwd, { grokHomeDir: home });
    expect(listed.map((entry) => entry.id)).toEqual(['sess-main']);
    expect(listed[0]?.title).toBe('README 고치기');
  });

  it('replays user and agent chunks from updates.jsonl', async () => {
    const home = await makeHome();
    const dir = path.join(home, 'one');
    await mkdir(dir, { recursive: true });
    const lines = [
      {
        timestamp: 1_786_705_000,
        method: 'session/update',
        params: {
          update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '[모드: Ask] 읽기만.\n\n안녕' } },
        },
      },
      {
        timestamp: 1_786_705_001,
        method: 'session/update',
        params: {
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '안녕하세요' } },
        },
      },
      {
        timestamp: 1_786_705_002,
        method: '_x.ai/session/update',
        params: { update: { sessionUpdate: 'turn_completed', stop_reason: 'end_turn' } },
      },
    ];
    await writeFile(path.join(dir, 'updates.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n'));
    const { items } = await replayCliTranscript(dir);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'user', text: '안녕' });
    expect(items[1]).toMatchObject({ kind: 'message', channel: 'answer', text: '안녕하세요' });
  });

  it('merges tool_call_update output and indexes user text for search', async () => {
    const home = await makeHome();
    const cwd = '/Users/me/search-proj';
    const group = path.join(home, 'sessions', encodeWorkspaceKey(cwd));
    const dir = path.join(group, 'sess-tools');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'summary.json'),
      JSON.stringify({
        info: { id: 'sess-tools', cwd },
        generated_title: 'README 읽기',
        last_turn_summary: 'README 요약을 씀',
        last_active_at: '2026-08-02T00:00:00.000Z',
      }),
    );
    await writeFile(
      path.join(dir, 'updates.jsonl'),
      [
        {
          timestamp: 1_786_705_000,
          method: 'session/update',
          params: {
            update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'rate limit 원인' } },
          },
        },
        {
          timestamp: 1_786_705_001,
          method: 'session/update',
          params: {
            update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'read_file' },
          },
        },
        {
          timestamp: 1_786_705_002,
          method: 'session/update',
          params: {
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: 't1',
              kind: 'read',
              title: 'Read README.md',
              status: 'completed',
              content: [{ type: 'content', content: { type: 'text', text: 'hello from file' } }],
            },
          },
        },
        {
          timestamp: 1_786_705_003,
          method: 'session/update',
          params: { update: { sessionUpdate: 'turn_completed', stop_reason: 'end_turn' } },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n'),
    );

    const listed = await listCliSessions(cwd, { grokHomeDir: home });
    expect(listed[0]?.preview).toContain('README 요약을 씀');
    expect(listed[0]?.searchText).toContain('rate limit 원인');

    const { items } = await replayCliTranscript(dir);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'user', text: 'rate limit 원인' });
    expect(items[1]).toMatchObject({
      kind: 'tool',
      call: { id: 't1', title: 'Read README.md', status: 'completed', output: 'hello from file' },
    });
  });
});
