import { appendFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyTranscriptEvent, type CachedChatItem, type SessionEvent } from '@grok-desktop/shared';
import { logger } from './logger.js';

/**
 * App-only events (approvals, file changes) that do not live in the CLI
 * updates.jsonl. One JSON object per line, append-only.
 */
export class OverlayLog {
  constructor(private readonly directory: string) {}

  #fileFor(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(this.directory, `${safe}.jsonl`);
  }

  async append(sessionId: string, event: SessionEvent): Promise<void> {
    if (event.type !== 'permission-resolved' && event.type !== 'file-changed' && event.type !== 'permission-request') {
      return;
    }
    try {
      await mkdir(this.directory, { recursive: true });
      await appendFile(this.#fileFor(sessionId), `${JSON.stringify({ at: new Date().toISOString(), event })}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch (error) {
      logger.warn('오버레이 로그를 쓰지 못했습니다.', { sessionId, reason: String(error) });
    }
  }

  async apply(sessionId: string, items: CachedChatItem[]): Promise<CachedChatItem[]> {
    const raw = await readFile(this.#fileFor(sessionId), 'utf8').catch(() => '');
    if (!raw) return items;
    let next = items;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { event?: SessionEvent };
        if (parsed.event) next = applyTranscriptEvent(next, parsed.event);
      } catch {
        // skip a corrupt line
      }
    }
    return next;
  }

  async remove(sessionId: string): Promise<void> {
    await unlink(this.#fileFor(sessionId)).catch(() => undefined);
  }

  /** Drop approval cards that rewind removed so they do not come back on resume. */
  async prune(sessionId: string, items: CachedChatItem[]): Promise<void> {
    const file = this.#fileFor(sessionId);
    const raw = await readFile(file, 'utf8').catch(() => '');
    if (!raw) return;
    const keepIds = new Set(items.filter((item) => item.kind === 'permission').map((item) => item.id));
    const kept: string[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { event?: SessionEvent };
        const event = parsed.event;
        if (!event) continue;
        if (event.type === 'permission-request' && keepIds.has(event.request.id)) kept.push(line);
        else if (event.type === 'permission-resolved' && keepIds.has(event.requestId)) kept.push(line);
        else if (event.type === 'file-changed') kept.push(line);
      } catch {
        // drop a corrupt line
      }
    }
    try {
      await writeFile(file, kept.length > 0 ? `${kept.join('\n')}\n` : '', { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      logger.warn('오버레이 로그를 줄이지 못했습니다.', { sessionId, reason: String(error) });
    }
  }
}
