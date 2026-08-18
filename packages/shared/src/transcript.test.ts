import { describe, expect, it } from 'vitest';
import {
  applyTranscriptEvent,
  sanitizeTranscript,
  titleFromPrompt,
  upsertChange,
} from './transcript.js';
import type { CachedChatItem } from './transcript.js';
import type { SessionEvent, ToolCallView } from './events.js';

const tool = (id: string, output = ''): ToolCallView => ({
  id,
  kind: 'read',
  title: '읽기',
  status: 'completed',
  locations: [],
  output,
  startedAt: '2026-01-01T00:00:00.000Z',
});

describe('titleFromPrompt', () => {
  it('collapses whitespace and caps long prompts', () => {
    expect(titleFromPrompt('  이 프로젝트\n구조를 설명해줘  ')).toBe('이 프로젝트 구조를 설명해줘');
    expect(titleFromPrompt('a'.repeat(80)).endsWith('…')).toBe(true);
    expect(titleFromPrompt('   ')).toBe('새 대화');
  });
});

describe('applyTranscriptEvent', () => {
  it('merges message deltas and upserts tools', () => {
    let items: CachedChatItem[] = [];
    items = applyTranscriptEvent(items, {
      type: 'message-delta',
      sessionId: 's',
      messageId: 'm1',
      channel: 'answer',
      text: '안녕',
    });
    items = applyTranscriptEvent(items, {
      type: 'message-delta',
      sessionId: 's',
      messageId: 'm1',
      channel: 'answer',
      text: '하세요',
    });
    items = applyTranscriptEvent(items, { type: 'tool-call', sessionId: 's', call: tool('t1', 'out') });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'message', text: '안녕하세요' });
    expect(items[1]).toMatchObject({ kind: 'tool', id: 't1' });
  });

  it('records a decision on a pending approval card', () => {
    const request = {
      id: 'p1',
      sessionId: 's',
      kind: 'edit' as const,
      title: '쓰기',
      risk: 'medium' as const,
      reasons: [],
      locations: [],
      options: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    let items: CachedChatItem[] = [];
    items = applyTranscriptEvent(items, { type: 'permission-request', sessionId: 's', request });
    items = applyTranscriptEvent(items, {
      type: 'permission-resolved',
      sessionId: 's',
      requestId: 'p1',
      decision: 'approved-once',
    });
    expect(items[0]).toMatchObject({ kind: 'permission', decision: 'approved-once' });
  });
});

describe('sanitizeTranscript', () => {
  it('drops unresolved approvals and marks changes non-revertable', () => {
    const items: CachedChatItem[] = [
      {
        kind: 'permission',
        id: 'open',
        request: {
          id: 'open',
          sessionId: 's',
          kind: 'edit',
          title: '쓰기',
          risk: 'medium',
          reasons: [],
          locations: [],
          options: [],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
      { kind: 'user', id: 'u1', text: 'hi', at: '2026-01-01T00:00:00.000Z' },
    ];
    const sanitized = sanitizeTranscript({
      version: 1,
      items,
      changes: [
        {
          path: '/tmp/a',
          relPath: 'a',
          status: 'modified',
          additions: 1,
          deletions: 0,
          revertable: true,
        },
      ],
    });
    expect(sanitized.items).toHaveLength(1);
    expect(sanitized.items[0]?.kind).toBe('user');
    expect(sanitized.changes[0]?.revertable).toBe(false);
  });
});

describe('upsertChange', () => {
  it('replaces the same path', () => {
    const first = {
      path: '/tmp/a',
      relPath: 'a.ts',
      status: 'added' as const,
      additions: 1,
      deletions: 0,
      revertable: true,
    };
    const next = { ...first, status: 'modified' as const, additions: 3 };
    expect(upsertChange([first], next)).toEqual([next]);
  });
});

describe('plan updates', () => {
  it('replaces the current plan instead of stacking cards', () => {
    let items: CachedChatItem[] = [];
    items = applyTranscriptEvent(items, {
      type: 'plan',
      sessionId: 's',
      entries: [{ content: 'one', status: 'pending' }],
    });
    items = applyTranscriptEvent(items, {
      type: 'plan',
      sessionId: 's',
      entries: [{ content: 'one', status: 'completed' }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'plan', entries: [{ status: 'completed' }] });
  });
});

describe('applyTranscriptEvent ignores non-chat events', () => {
  it('leaves items alone for status ticks', () => {
    const event: SessionEvent = { type: 'session-status', sessionId: 's', status: 'idle' };
    expect(applyTranscriptEvent([], event)).toEqual([]);
  });
});
