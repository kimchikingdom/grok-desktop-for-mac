import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { maskSecrets } from '@grok-desktop/security';
import {
  EMPTY_SESSION_CACHE,
  sanitizeTranscript,
  type CachedChatItem,
  type SessionCache,
} from '@grok-desktop/shared';
import { logger } from './logger.js';

/**
 * Per-session UI cache next to metadata.json. Tokens never belong here —
 * every string is masked again on the way to disk (spec 10, 8.3).
 */
export class TranscriptStore {
  /** One write chain per session: flushes can overlap (timer + park + exit). */
  #chains = new Map<string, Promise<void>>();

  constructor(private readonly directory: string) {}

  #fileFor(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.directory, `${safe}.json`);
  }

  async load(sessionId: string): Promise<SessionCache> {
    try {
      const raw = await readFile(this.#fileFor(sessionId), 'utf8');
      const parsed = JSON.parse(raw) as Partial<SessionCache>;
      return sanitizeTranscript({
        version: 1,
        items: Array.isArray(parsed.items) ? parsed.items : [],
        changes: Array.isArray(parsed.changes) ? parsed.changes : [],
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logger.warn('세션 대화를 읽지 못했습니다.', { sessionId, reason: String(error) });
      }
      return { ...EMPTY_SESSION_CACHE };
    }
  }

  async save(sessionId: string, cache: SessionCache): Promise<void> {
    const sanitized = sanitizeTranscript({
      version: 1,
      items: cache.items.map(maskItem),
      changes: cache.changes,
    });

    const previous = this.#chains.get(sessionId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const target = this.#fileFor(sessionId);
        // A unique temp name keeps two overlapping saves from stealing each
        // other's file between write and rename.
        const temp = `${target}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify(sanitized), { encoding: 'utf8', mode: 0o600 });
        try {
          await rename(temp, target);
        } catch (error) {
          await unlink(temp).catch(() => undefined);
          throw error;
        }
      });

    this.#chains.set(sessionId, next);
    try {
      await next;
    } finally {
      if (this.#chains.get(sessionId) === next) this.#chains.delete(sessionId);
    }
  }

  async remove(sessionId: string): Promise<void> {
    await unlink(this.#fileFor(sessionId)).catch(() => undefined);
  }
}

function maskItem(item: CachedChatItem): CachedChatItem {
  switch (item.kind) {
    case 'user':
    case 'message':
      return { ...item, text: maskSecrets(item.text) };
    case 'error':
      return {
        ...item,
        message: maskSecrets(item.message),
        detail: item.detail ? maskSecrets(item.detail) : undefined,
      };
    case 'tool':
      return {
        ...item,
        call: {
          ...item.call,
          output: item.call.output ? maskSecrets(item.call.output) : undefined,
          command: item.call.command ? maskSecrets(item.call.command) : undefined,
          error: item.call.error ? maskSecrets(item.call.error) : undefined,
        },
      };
    case 'permission':
      return {
        ...item,
        request: {
          ...item.request,
          command: item.request.command ? maskSecrets(item.request.command) : undefined,
          rationale: item.request.rationale ? maskSecrets(item.request.rationale) : undefined,
        },
      };
    case 'plan':
      return {
        ...item,
        entries: item.entries.map((entry) => ({ ...entry, content: maskSecrets(entry.content) })),
      };
    default:
      return item;
  }
}
