import { describe, expect, it } from 'vitest';
import { activeTurnIndex, clipTurnLabel, findChatHits, offsetForId, turnMarksFromItems } from './turn-nav.js';
import type { ChatItem } from './store.js';

const items: ChatItem[] = [
  { kind: 'user', id: 'u1', text: '첫 질문', at: '2026-01-01T00:00:00.000Z' },
  { kind: 'message', id: 'a1:answer', channel: 'answer', text: '첫 답변입니다' },
  {
    kind: 'tool',
    id: 't1',
    call: {
      id: 't1',
      kind: 'read',
      title: '읽기',
      status: 'completed',
      locations: [],
      startedAt: '2026-01-01T00:00:00.000Z',
    },
  },
  { kind: 'user', id: 'u2', text: '두 번째', at: '2026-01-01T00:01:00.000Z' },
  { kind: 'message', id: 'a2:answer', channel: 'answer', text: '두 번째 답변' },
  { kind: 'error', id: 'e1', code: 'timeout', message: '응답이 늦었습니다' },
];

describe('turnMarksFromItems', () => {
  it('keeps user, answer, and error stops and skips tools', () => {
    expect(turnMarksFromItems(items).map((mark) => mark.id)).toEqual([
      'u1',
      'a1:answer',
      'u2',
      'a2:answer',
      'e1',
    ]);
    expect(turnMarksFromItems(items).map((mark) => mark.kind)).toEqual([
      'user',
      'answer',
      'user',
      'answer',
      'error',
    ]);
  });

  it('clips a long label to one line', () => {
    expect(clipTurnLabel('hello\nworld '.repeat(20)).includes('\n')).toBe(false);
    expect(clipTurnLabel('short')).toBe('short');
  });
});

describe('findChatHits', () => {
  it('finds user and answer text and skips tools', () => {
    expect(findChatHits(items, '두 번째')).toEqual(['u2', 'a2:answer']);
    expect(findChatHits(items, '읽기')).toEqual([]);
  });
});

describe('activeTurnIndex', () => {
  it('picks the last mark whose offset is above the probe', () => {
    const marks = turnMarksFromItems(items);
    const keys = items.map((item) => item.id);
    const offsets = [0, 100, 200, 300, 400, 500];
    expect(activeTurnIndex(marks, keys, offsets, 0, 200)).toBe(0);
    expect(offsetForId(keys, offsets, 'u2')).toBe(300);
    expect(activeTurnIndex(marks, keys, offsets, 280, 200)).toBe(2);
  });
});
