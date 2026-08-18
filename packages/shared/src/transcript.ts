import type { FileChangeSummary, PlanEntry, SessionEvent, ToolCallView } from './events.js';
import type { PermissionRequestView } from './events.js';

/** UI-restore cache (spec 10). Not a second source of truth for the agent. */
export type CachedChatItem =
  | { kind: 'user'; id: string; text: string; at: string; attachments?: string[] }
  | { kind: 'message'; id: string; channel: 'answer' | 'thought'; text: string }
  | { kind: 'tool'; id: string; call: ToolCallView }
  | { kind: 'permission'; id: string; request: PermissionRequestView; decision?: string }
  | { kind: 'plan'; id: string; entries: PlanEntry[] }
  | { kind: 'subagent'; id: string; title: string; status: 'running' | 'completed' | 'failed'; detail?: string }
  | { kind: 'task'; id: string; title: string; status: 'running' | 'completed' | 'failed' }
  | { kind: 'error'; id: string; code: string; message: string; detail?: string };

export type SessionCache = {
  version: 1;
  items: CachedChatItem[];
  changes: FileChangeSummary[];
};

export type AgentContext = 'loaded' | 'fresh';

export const MAX_TRANSCRIPT_ITEMS = 2_000;
export const MAX_TRANSCRIPT_TEXT = 200_000;
export const MAX_TRANSCRIPT_OUTPUT = 64_000;

export const EMPTY_SESSION_CACHE: SessionCache = { version: 1, items: [], changes: [] };

/** First user prompt becomes the session title when it is still the folder name. */
export function titleFromPrompt(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '새 대화';
  return oneLine.length <= 48 ? oneLine : `${oneLine.slice(0, 45)}…`;
}

export function applyTranscriptEvent(items: CachedChatItem[], event: SessionEvent): CachedChatItem[] {
  switch (event.type) {
    case 'message-delta':
      return appendDelta(items, event.messageId, event.channel, event.text);
    case 'plan': {
      const plan = { kind: 'plan' as const, id: event.id ?? 'plan', entries: event.entries };
      const existing = items.findIndex((item) => item.kind === 'plan' && item.id === plan.id);
      if (existing >= 0) {
        return items.map((item, index) => (index === existing ? plan : item));
      }
      return [...items, plan];
    }
    case 'subagent':
      return upsertNamed(items, {
        kind: 'subagent',
        id: event.id,
        title: event.title,
        status: event.status,
        detail: event.detail,
      });
    case 'transcript-replaced':
      return event.items;
    case 'background-task':
      return upsertNamed(items, {
        kind: 'task',
        id: event.id,
        title: event.title,
        status: event.status,
      });
    case 'tool-call':
      return upsertTool(items, event.call);
    case 'terminal-output':
      return appendToolOutput(items, event.toolCallId, event.chunk);
    case 'permission-request':
      return [...items, { kind: 'permission', id: event.request.id, request: event.request }];
    case 'permission-resolved':
      return items.map((item) =>
        item.kind === 'permission' && item.id === event.requestId
          ? { ...item, decision: event.decision }
          : item,
      );
    case 'error':
      return [
        ...items,
        {
          kind: 'error',
          id: event.id ?? `error-${items.length}`,
          code: event.code,
          message: event.message,
          detail: event.detail,
        },
      ];
    default:
      return items;
  }
}

export function upsertChange(
  changes: FileChangeSummary[],
  change: FileChangeSummary,
): FileChangeSummary[] {
  return [...changes.filter((entry) => entry.relPath !== change.relPath), change].sort((a, b) =>
    a.relPath.localeCompare(b.relPath),
  );
}

export function shouldFlushTranscript(event: SessionEvent): boolean {
  return (
    event.type === 'turn-ended' ||
    event.type === 'permission-resolved' ||
    event.type === 'error' ||
    event.type === 'file-changed'
  );
}

/** Drop stale approval cards and cap size so a long session cannot bloat disk. */
export function sanitizeTranscript(cache: SessionCache): SessionCache {
  const items = cache.items
    .filter((item) => item.kind !== 'permission' || item.decision)
    .slice(-MAX_TRANSCRIPT_ITEMS)
    .map(truncateItem);
  const changes = cache.changes.map((change) => ({ ...change, revertable: false }));
  return { version: 1, items, changes };
}

function truncateItem(item: CachedChatItem): CachedChatItem {
  switch (item.kind) {
    case 'user':
    case 'message':
      return { ...item, text: clip(item.text, MAX_TRANSCRIPT_TEXT) };
    case 'error':
      return {
        ...item,
        message: clip(item.message, MAX_TRANSCRIPT_TEXT),
        detail: item.detail ? clip(item.detail, MAX_TRANSCRIPT_OUTPUT) : undefined,
      };
    case 'tool':
      return {
        ...item,
        call: {
          ...item.call,
          output: item.call.output ? clip(item.call.output, MAX_TRANSCRIPT_OUTPUT) : undefined,
          media: item.call.media?.map((entry) => ({ ...entry, dataUrl: undefined })),
        },
      };
    default:
      return item;
  }
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(잘림)`;
}

function appendDelta(
  items: CachedChatItem[],
  messageId: string,
  channel: 'answer' | 'thought',
  text: string,
): CachedChatItem[] {
  const key = `${messageId}:${channel}`;
  const index = items.findIndex((item) => item.kind === 'message' && item.id === key);
  if (index === -1) return [...items, { kind: 'message', id: key, channel, text }];
  return items.map((item, position) =>
    position === index && item.kind === 'message' ? { ...item, text: item.text + text } : item,
  );
}

function upsertNamed(
  items: CachedChatItem[],
  next: Extract<CachedChatItem, { kind: 'subagent' | 'task' }>,
): CachedChatItem[] {
  const index = items.findIndex((item) => item.kind === next.kind && item.id === next.id);
  if (index === -1) return [...items, next];
  return items.map((item, position) => (position === index ? next : item));
}

function upsertTool(items: CachedChatItem[], call: ToolCallView): CachedChatItem[] {
  const index = items.findIndex((item) => item.kind === 'tool' && item.id === call.id);
  if (index === -1) return [...items, { kind: 'tool', id: call.id, call }];
  return items.map((item, position) =>
    position === index && item.kind === 'tool' ? { ...item, call } : item,
  );
}

function appendToolOutput(items: CachedChatItem[], toolCallId: string, chunk: string): CachedChatItem[] {
  return items.map((item) =>
    item.kind === 'tool' && item.id === toolCallId
      ? { ...item, call: { ...item.call, output: `${item.call.output ?? ''}${chunk}` } }
      : item,
  );
}
