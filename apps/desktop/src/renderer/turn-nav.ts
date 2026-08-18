import type { ChatItem } from './store.js';

export type TurnMark = {
  id: string;
  kind: 'user' | 'answer' | 'error';
  label: string;
};

export function clipTurnLabel(text: string, max = 72): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '빈 메시지';
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** User prompts, assistant answers, and errors — the stops on the chat rail. */
export function turnMarksFromItems(items: ChatItem[]): TurnMark[] {
  const marks: TurnMark[] = [];
  for (const item of items) {
    if (item.kind === 'user') {
      marks.push({ id: item.id, kind: 'user', label: clipTurnLabel(item.text) });
    } else if (item.kind === 'message' && item.channel === 'answer') {
      marks.push({ id: item.id, kind: 'answer', label: clipTurnLabel(item.text) });
    } else if (item.kind === 'error') {
      marks.push({ id: item.id, kind: 'error', label: clipTurnLabel(item.message) });
    }
  }
  return marks;
}

export function findChatHits(items: ChatItem[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: string[] = [];
  for (const item of items) {
    if (item.kind === 'user' || item.kind === 'message') {
      if (item.text.toLowerCase().includes(needle)) hits.push(item.id);
    } else if (item.kind === 'error' && item.message.toLowerCase().includes(needle)) {
      hits.push(item.id);
    }
  }
  return hits;
}

export function offsetForId(keys: string[], offsets: number[], id: string): number | undefined {
  const index = keys.indexOf(id);
  if (index < 0) return undefined;
  return offsets[index];
}

/** The mark whose start is at or above a point 35% down the viewport. */
export function activeTurnIndex(
  marks: TurnMark[],
  keys: string[],
  offsets: number[],
  scrollTop: number,
  viewport: number,
): number {
  if (marks.length === 0) return -1;
  const probe = scrollTop + Math.max(24, viewport * 0.35);
  let active = 0;
  for (let index = 0; index < marks.length; index += 1) {
    const top = offsetForId(keys, offsets, marks[index]?.id ?? '');
    if (top !== undefined && top <= probe) active = index;
  }
  return active;
}
