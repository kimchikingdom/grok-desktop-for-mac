import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ApprovalRecord, SessionRecord, WorkspaceRecord } from '@grok-desktop/shared';
import { logger } from './logger.js';

type StoreShape = {
  version: 1;
  workspaces: WorkspaceRecord[];
  sessions: SessionRecord[];
  approvals: ApprovalRecord[];
};

const EMPTY: StoreShape = { version: 1, workspaces: [], sessions: [], approvals: [] };

/**
 * Local metadata only (spec 10): no auth tokens, no full transcripts.
 * A single JSON document keeps the app dependency-free and easy to inspect.
 */
export class MetadataStore {
  #data: StoreShape = structuredClone(EMPTY);
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreShape>;
      this.#data = {
        version: 1,
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [],
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logger.warn('세션 저장소를 읽지 못해 새로 시작합니다.', { reason: String(error) });
      }
      this.#data = structuredClone(EMPTY);
    }
  }

  #persist(): void {
    const snapshot = JSON.stringify(this.#data, null, 2);
    this.#writeQueue = this.#writeQueue
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        const temp = `${this.filePath}.tmp`;
        await writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600 });
        await rename(temp, this.filePath);
      })
      .catch((error: unknown) => {
        logger.error('세션 저장소 기록에 실패했습니다.', { reason: String(error) });
      });
  }

  async flush(): Promise<void> {
    await this.#writeQueue;
  }

  listWorkspaces(): WorkspaceRecord[] {
    return [...this.#data.workspaces].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }

  getWorkspace(id: string): WorkspaceRecord | undefined {
    return this.#data.workspaces.find((workspace) => workspace.id === id);
  }

  findWorkspaceByRoot(canonicalRootPath: string): WorkspaceRecord | undefined {
    return this.#data.workspaces.find((workspace) => workspace.canonicalRootPath === canonicalRootPath);
  }

  upsertWorkspace(input: Omit<WorkspaceRecord, 'id' | 'createdAt' | 'lastOpenedAt'>): WorkspaceRecord {
    const now = new Date().toISOString();
    const existing = this.findWorkspaceByRoot(input.canonicalRootPath);
    if (existing) {
      Object.assign(existing, input, { lastOpenedAt: now });
      this.#persist();
      return existing;
    }
    const record: WorkspaceRecord = { ...input, id: randomUUID(), createdAt: now, lastOpenedAt: now };
    this.#data.workspaces.push(record);
    if (this.#data.workspaces.length > 30) {
      const kept = this.listWorkspaces().slice(0, 30);
      const keptIds = new Set(kept.map((workspace) => workspace.id));
      this.#data.workspaces = kept;
      this.#data.sessions = this.#data.sessions.filter((session) => keptIds.has(session.workspaceId));
    }
    this.#persist();
    return record;
  }

  listSessions(): SessionRecord[] {
    return [...this.#data.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getSession(id: string): SessionRecord | undefined {
    return this.#data.sessions.find((session) => session.id === id);
  }

  findSessionByGrokId(grokSessionId: string): SessionRecord | undefined {
    return this.#data.sessions.find((session) => session.grokSessionId === grokSessionId);
  }

  createSession(
    input: Omit<SessionRecord, 'id' | 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string },
  ): SessionRecord {
    const now = new Date().toISOString();
    const record: SessionRecord = {
      ...input,
      id: randomUUID(),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    this.#data.sessions.push(record);
    this.#persist();
    return record;
  }

  updateWorkspace(id: string, patch: Partial<Omit<WorkspaceRecord, 'id' | 'createdAt'>>): WorkspaceRecord | undefined {
    const workspace = this.getWorkspace(id);
    if (!workspace) return undefined;
    Object.assign(workspace, patch, { lastOpenedAt: workspace.lastOpenedAt });
    this.#persist();
    return workspace;
  }

  deleteSession(id: string): boolean {
    const before = this.#data.sessions.length;
    this.#data.sessions = this.#data.sessions.filter((session) => session.id !== id);
    this.#data.approvals = this.#data.approvals.filter((approval) => approval.sessionId !== id);
    if (this.#data.sessions.length === before) return false;
    this.#persist();
    return true;
  }

  updateSession(id: string, patch: Partial<Omit<SessionRecord, 'id'>>): SessionRecord | undefined {
    const session = this.getSession(id);
    if (!session) return undefined;
    Object.assign(session, patch, { updatedAt: new Date().toISOString() });
    this.#persist();
    return session;
  }

  recordApproval(input: Omit<ApprovalRecord, 'id' | 'createdAt'>): ApprovalRecord {
    const record: ApprovalRecord = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.#data.approvals.push(record);
    if (this.#data.approvals.length > 2000) this.#data.approvals.splice(0, 500);
    this.#persist();
    return record;
  }

  listApprovals(sessionId: string): ApprovalRecord[] {
    return this.#data.approvals.filter((approval) => approval.sessionId === sessionId);
  }
}
