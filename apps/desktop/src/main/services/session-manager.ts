import { randomUUID } from 'node:crypto';
import { access, mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  GrokAgentConnection,
  JSON_RPC_ERRORS,
  type AcpSessionUpdate,
  type AcpToolCall,
  type PermissionOutcome,
  type RequestPermissionParams,
  type TryRequestResult,
} from '@grok-desktop/acp-client';
import {
  PathEscapeError,
  classifySensitivity,
  describePath,
  maskSecrets,
  resolveWithinRoot,
} from '@grok-desktop/security';
import type {
  AgentContext,
  CachedChatItem,
  DiffPreview,
  FileChangeSummary,
  PermissionDecision,
  PermissionOption,
  PermissionRequestView,
  RiskLevel,
  SessionEvent,
  SessionOpenResult,
  SessionSummary,
  StopReason,
  ToolCallView,
  ToolKind,
  ToolLocation,
  UsageSnapshot,
  WorkMode,
  WorkspaceRecord,
  PermissionProfile,
  PromptToolFlag,
  SessionExport,
  ToolMedia,
} from '@grok-desktop/shared';
import {
  applyTranscriptEvent,
  shouldFlushTranscript,
  titleFromPrompt,
  upsertChange,
} from '@grok-desktop/shared';
import {
  findCliSession,
  grokHome,
  listCliSessions,
  removeCliSessionDirectory,
  renameCliSessionTitle,
  replayCliTranscript,
  type CliSessionIndex,
} from './cli-sessions.js';
import { applyWorktreeToMain, createSessionWorktree, removeSessionWorktree } from './worktrees.js';
import { buildDiffPreview, collectGitChanges, type ChangeTracker } from './diff.js';
import { mediaKindFor, readMedia } from './files.js';
import { logger } from './logger.js';
import type { OverlayLog } from './overlay-log.js';
import { composePromptText } from './prompt-compose.js';
import { evaluatePermission, grantKeyFor } from './permission-engine.js';
import type { MetadataStore } from './store.js';
import type { TranscriptStore } from './transcript.js';
import { readSessionUsage } from './usage.js';

function extensionFailure(action: string, result: Extract<TryRequestResult, { ok: false }>): string {
  if (result.code === JSON_RPC_ERRORS.methodNotFound) {
    return `이 CLI는 대화 ${action}를 지원하지 않습니다. 화면을 바꾸지 않았습니다.`;
  }
  return `대화 ${action}에 실패했습니다. 화면을 바꾸지 않았습니다. (${result.message})`;
}

type PendingPermission = {
  view: PermissionRequestView;
  options: RequestPermissionParams['options'];
  resolve: (outcome: PermissionOutcome) => void;
  grantKey: string;
  locations: ToolLocation[];
  tool: string;
};

type LiveSession = {
  id: string;
  grokSessionId: string;
  /** Path to the CLI binary, kept so usage can be read back after a turn. */
  binaryPath: string;
  workspace: WorkspaceRecord;
  mode: WorkMode;
  connection: GrokAgentConnection;
  grants: Set<string>;
  pending: Map<string, PendingPermission>;
  toolCalls: Map<string, ToolCallView>;
  /** Paths approved for writing during the current turn. */
  writeAllowance: Set<string>;
  messageId: string | null;
  running: boolean;
  /** Set when the user (or a park) asked to stop the in-flight turn. */
  cancelRequested: boolean;
  /** Working directory for this ACP session (workspace root or a git worktree). */
  cwd: string;
  items: CachedChatItem[];
  changeSummaries: FileChangeSummary[];
  /** Everything the app can honestly report about consumption. */
  usage: UsageSnapshot;
};

export type CreateSessionArgs = {
  workspace: WorkspaceRecord;
  mode: WorkMode;
  title?: string;
  binaryPath: string;
  /** Only true when the user is authenticating with an explicit API key. */
  includeApiKey?: boolean;
  /** Overrides `agent stdio`; used by the fake-agent integration tests. */
  args?: string[];
  /** Model id for `-m`; omitted means the agent's own default. */
  model?: string;
  isolation?: 'none' | 'worktree';
};

/** Ask/Plan are read-only regardless of what the workspace profile allows. */
function effectiveProfile(mode: WorkMode, profile: PermissionProfile): PermissionProfile {
  return mode === 'agent' ? profile : 'read-only';
}

const MAX_SESSIONS_PER_WORKSPACE = 20;

export class SessionManager {
  #sessions = new Map<string, LiveSession>();
  #flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly store: MetadataStore,
    private readonly changes: ChangeTracker,
    private readonly emit: (event: SessionEvent) => void,
    private readonly transcripts: TranscriptStore,
    private readonly orphans?: { register: (pid: number) => void; release: (pid: number) => void },
    private readonly overlays?: OverlayLog,
    private readonly grokHomeDir?: string,
  ) {}

  getWorkspace(sessionId: string): WorkspaceRecord | undefined {
    const live = this.#sessions.get(sessionId);
    if (!live) return undefined;
    if (live.cwd === live.workspace.canonicalRootPath) return live.workspace;
    return { ...live.workspace, canonicalRootPath: live.cwd, rootPath: live.cwd };
  }

  isLive(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  async create(args: CreateSessionArgs): Promise<SessionSummary> {
    await this.#ensureLiveCapacity();
    this.#pruneWorkspaceSessions(args.workspace.id);

    let cwd = args.workspace.canonicalRootPath;
    let worktreePath: string | undefined;
    let worktreeLabel: string | undefined;
    if (args.isolation === 'worktree') {
      const created = await createSessionWorktree(cwd, this.grokHomeDir ?? grokHome());
      cwd = created.cwd;
      worktreePath = created.cwd;
      worktreeLabel = created.label;
    }

    const record = this.store.createSession({
      workspaceId: args.workspace.id,
      title: args.title ?? args.workspace.displayName,
      mode: args.mode,
      status: 'starting',
      model: args.model,
      worktreePath,
      worktreeLabel,
    });

    const connection = this.#buildConnection(record.id, { ...args.workspace, canonicalRootPath: cwd, rootPath: cwd }, args);

    connection.on('transport-error', (error: Error) => {
      logger.warn('ACP 전송 오류', { sessionId: record.id, reason: error.message });
    });

    try {
      await connection.start();
      const grokSessionId = await connection.newSession(cwd);

      this.#sessions.set(record.id, {
        id: record.id,
        grokSessionId,
        workspace: args.workspace,
        mode: args.mode,
        connection,
        grants: new Set(),
        pending: new Map(),
        toolCalls: new Map(),
        writeAllowance: new Set(),
        messageId: null,
        running: false,
        cancelRequested: false,
        cwd,
        items: [],
        changeSummaries: [],
        binaryPath: args.binaryPath,
        usage: initialUsage(connection, args.model),
      });

      const updated = this.store.updateSession(record.id, { status: 'idle', grokSessionId }) ?? record;
      this.#broadcast(record.id, { type: 'session-status', sessionId: record.id, status: 'idle' });
      this.#publishSummary(record.id);
      const live = this.#sessions.get(record.id);
      if (live) {
        this.#publishModels(live);
        // A brand new CLI session has nothing recorded yet, but a reused id does.
        void this.#refreshSessionUsage(live);
      }
      logger.info('세션을 시작했습니다.', {
        sessionId: record.id,
        cwd,
        mode: args.mode,
        worktree: worktreeLabel,
      });
      this.store.updateWorkspace(args.workspace.id, { lastSessionId: record.id });
      return { ...updated, workspace: toWorkspaceSummary(args.workspace) };
    } catch (error) {
      await connection.dispose().catch(() => undefined);
      this.store.updateSession(record.id, { status: 'failed' });
      const message = error instanceof Error ? error.message : String(error);
      logger.error('세션 시작 실패', { sessionId: record.id, reason: message });
      throw new Error(`Grok 세션을 시작하지 못했습니다: ${message}`);
    }
  }

  async resume(args: {
    sessionId: string;
    binaryPath: string;
    includeApiKey?: boolean;
    args?: string[];
    mode?: WorkMode;
    /** Overrides the model stored on the record (used by setModel). */
    model?: string;
  }): Promise<SessionOpenResult> {
    const record = this.store.getSession(args.sessionId);
    if (!record) throw new Error('세션을 찾을 수 없습니다.');
    const workspace = this.store.getWorkspace(record.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');

    const existing = this.#sessions.get(record.id);
    if (existing && existing.connection.state === 'ready') {
      if (args.mode && args.mode !== existing.mode) {
        existing.mode = args.mode;
        this.store.updateSession(existing.id, { mode: args.mode });
      }
      return this.#toOpenResult(existing, 'loaded');
    }

    await this.#ensureLiveCapacity();

    const persisted = await this.#loadPersistedItems(record);
    const persistedItems = persisted.items;
    const cache = await this.transcripts.load(record.id);
    const mode = args.mode ?? record.mode;
    const model = args.model ?? record.model;
    this.store.updateSession(record.id, { status: 'starting', mode, model });

    const cwd = await this.#sessionCwd(record, workspace);
    const connection = this.#buildConnection(
      record.id,
      { ...workspace, canonicalRootPath: cwd, rootPath: cwd },
      { ...args, model },
    );
    connection.on('transport-error', (error: Error) => {
      logger.warn('ACP 전송 오류', { sessionId: record.id, reason: error.message });
    });

    try {
      await connection.start();
      let grokSessionId = record.grokSessionId;
      let agentContext: AgentContext = 'fresh';

      if (grokSessionId && connection.supportsLoadSession) {
        try {
          grokSessionId = await connection.loadSession(grokSessionId, cwd);
          agentContext = 'loaded';
        } catch (error) {
          logger.warn('이전 에이전트 세션을 불러오지 못해 새로 시작합니다.', {
            sessionId: record.id,
            reason: String(error),
          });
          grokSessionId = await connection.newSession(cwd);
        }
      } else {
        grokSessionId = await connection.newSession(cwd);
      }

      const live: LiveSession = {
        id: record.id,
        grokSessionId,
        workspace,
        mode,
        connection,
        grants: new Set(),
        pending: new Map(),
        toolCalls: new Map(),
        writeAllowance: new Set(),
        messageId: null,
        running: false,
        cancelRequested: false,
        cwd,
        items: persistedItems.length > 0 ? persistedItems : cache.items,
        changeSummaries: persisted.changes.length > 0 ? persisted.changes : cache.changes,
        binaryPath: args.binaryPath,
        usage: initialUsage(connection, args.model ?? record.model),
      };
      this.#sessions.set(record.id, live);

      this.store.updateWorkspace(workspace.id, { lastSessionId: record.id });
      const updated = this.store.updateSession(record.id, { status: 'idle', grokSessionId, mode }) ?? record;
      this.#broadcast(record.id, { type: 'session-status', sessionId: record.id, status: 'idle' });
      this.#publishSummary(record.id);
      this.#publishModels(live);
      void this.#refreshSessionUsage(live);
      logger.info('세션을 재개했습니다.', {
        sessionId: record.id,
        agentContext,
        cwd,
      });
      return {
        session: { ...updated, workspace: toWorkspaceSummary(workspace), live: true },
        items: live.items,
        changes: live.changeSummaries,
        agentContext,
      };
    } catch (error) {
      await connection.dispose().catch(() => undefined);
      this.store.updateSession(record.id, { status: 'failed' });
      const message = error instanceof Error ? error.message : String(error);
      logger.error('세션 재개 실패', { sessionId: record.id, reason: message });
      throw new Error(`세션을 재개하지 못했습니다: ${message}`);
    }
  }

  async restart(args: {
    sessionId: string;
    binaryPath: string;
    includeApiKey?: boolean;
    args?: string[];
  }): Promise<SessionOpenResult> {
    const live = this.#sessions.get(args.sessionId);
    if (live) await this.#park(live, 'idle');
    return this.resume(args);
  }

  /**
   * The agent takes its model from the `-m` flag at process start, so switching
   * means restarting the CLI and reloading the conversation through
   * `session/load`. The transcript in the UI is untouched either way.
   */
  async setModel(args: {
    sessionId: string;
    model: string;
    binaryPath: string;
    includeApiKey?: boolean;
    args?: string[];
  }): Promise<SessionOpenResult> {
    const record = this.store.getSession(args.sessionId);
    if (!record) throw new Error('세션을 찾을 수 없습니다.');
    if (record.model === args.model && this.isLive(args.sessionId)) {
      const open = this.openResult(args.sessionId);
      if (open) return open;
    }

    const live = this.#sessions.get(args.sessionId);
    if (live) await this.#park(live, 'idle');
    this.store.updateSession(args.sessionId, { model: args.model });
    logger.info('모델을 변경합니다.', { sessionId: args.sessionId, model: args.model });
    return this.resume({ ...args, model: args.model });
  }

  rename(sessionId: string, title: string): SessionSummary {
    const trimmed = title.trim();
    if (!trimmed) throw new Error('세션 이름이 비어 있습니다.');
    const updated = this.store.updateSession(sessionId, { title: trimmed.slice(0, 200) });
    if (!updated) throw new Error('세션을 찾을 수 없습니다.');
    const workspace = this.store.getWorkspace(updated.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');
    const summary = {
      ...updated,
      workspace: toWorkspaceSummary(workspace),
      live: this.#sessions.has(sessionId),
    };
    this.#publish({ type: 'session-updated', session: summary });
    if (updated.grokSessionId) {
      void renameCliSessionTitle(
        workspace.canonicalRootPath,
        updated.grokSessionId,
        summary.title,
        this.grokHomeDir,
      );
    }
    return summary;
  }

  async importCliSessions(workspace: WorkspaceRecord): Promise<CliSessionIndex[]> {
    const listed = await listCliSessions(workspace.canonicalRootPath, { grokHomeDir: this.grokHomeDir });
    for (const entry of listed) {
      const existing = this.store.findSessionByGrokId(entry.id);
      if (existing) {
        const patch: Partial<typeof existing> = {};
        if (existing.status === 'closed') patch.status = 'idle';
        if (existing.title === workspace.displayName || existing.title.startsWith('[모드:')) {
          patch.title = entry.title;
        }
        if (entry.model && !existing.model) patch.model = entry.model;
        if (Object.keys(patch).length > 0) this.store.updateSession(existing.id, patch);
        continue;
      }
      this.store.createSession({
        grokSessionId: entry.id,
        workspaceId: workspace.id,
        title: entry.title,
        mode: 'agent',
        status: 'idle',
        model: entry.model,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      });
    }
    return listed;
  }

  applyWorkspace(workspace: WorkspaceRecord): void {
    for (const session of this.#sessions.values()) {
      if (session.workspace.id === workspace.id) session.workspace = workspace;
    }
  }

  async delete(sessionId: string): Promise<void> {
    const record = this.store.getSession(sessionId);
    const workspace = record ? this.store.getWorkspace(record.workspaceId) : undefined;
    await this.disposeSession(sessionId);
    if (record?.grokSessionId && workspace) {
      await removeCliSessionDirectory(workspace.canonicalRootPath, record.grokSessionId, this.grokHomeDir);
    }
    if (record?.worktreePath && workspace) {
      await removeSessionWorktree(workspace.canonicalRootPath, record.worktreePath);
    }
    this.store.deleteSession(sessionId);
    await this.transcripts.remove(sessionId);
    await this.overlays?.remove(sessionId);
  }

  exportTranscript(sessionId: string): SessionExport {
    const live = this.#sessions.get(sessionId);
    const record = this.store.getSession(sessionId);
    if (!record) throw new Error('세션을 찾을 수 없습니다.');
    const items = live?.items ?? [];
    return { title: record.title, markdown: itemsToMarkdown(record.title, items) };
  }

  async exportTranscriptAsync(sessionId: string): Promise<SessionExport> {
    const live = this.#sessions.get(sessionId);
    if (live) return this.exportTranscript(sessionId);
    const record = this.store.getSession(sessionId);
    if (!record) throw new Error('세션을 찾을 수 없습니다.');
    const items = (await this.#loadPersistedItems(record)).items;
    return { title: record.title, markdown: itemsToMarkdown(record.title, items) };
  }

  async exportRawJsonl(sessionId: string): Promise<string> {
    const record = this.store.getSession(sessionId);
    if (!record) throw new Error('세션을 찾을 수 없습니다.');
    const workspace = this.store.getWorkspace(record.workspaceId);
    if (record.grokSessionId && workspace) {
      const cli = await findCliSession(workspace.canonicalRootPath, record.grokSessionId, this.grokHomeDir);
      if (cli) {
        const { readFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        // The raw CLI log can hold whatever the agent read (.env values, tokens
        // in command output), and this export goes to the clipboard.
        const raw = await readFile(join(cli.directory, 'updates.jsonl'), 'utf8').catch(() => '');
        return maskSecrets(raw);
      }
    }
    const items = this.#sessions.get(sessionId)?.items ?? (await this.#loadPersistedItems(record)).items;
    return items.map((item) => JSON.stringify(item)).join('\n');
  }

  sessionInfo(sessionId: string): {
    id: string;
    grokSessionId?: string;
    cwd: string;
    model?: string;
    worktreeLabel?: string;
    messageCount: number;
  } {
    const record = this.store.getSession(sessionId);
    if (!record) throw new Error('세션을 찾을 수 없습니다.');
    const live = this.#sessions.get(sessionId);
    return {
      id: record.id,
      grokSessionId: record.grokSessionId,
      cwd: live?.cwd ?? record.worktreePath ?? this.store.getWorkspace(record.workspaceId)?.canonicalRootPath ?? '',
      model: record.model,
      worktreeLabel: record.worktreeLabel,
      messageCount: live?.items.filter((item) => item.kind === 'user' || item.kind === 'message').length ?? 0,
    };
  }

  async rewindToUser(
    sessionId: string,
    userItemId: string,
    keepUser = true,
  ): Promise<CachedChatItem[]> {
    const session = this.#requireSession(sessionId);
    const index = session.items.findIndex((item) => item.kind === 'user' && item.id === userItemId);
    if (index < 0) throw new Error('되돌릴 사용자 메시지를 찾지 못했습니다.');
    const userIndex = session.items.slice(0, index + 1).filter((item) => item.kind === 'user').length - 1;
    const promptIndex = keepUser ? userIndex : userIndex - 1;
    const result = await session.connection.tryRequest('x.ai/rewind', {
      sessionId: session.grokSessionId,
      promptIndex,
    });
    if (!result.ok) {
      throw new Error(extensionFailure('되돌리기', result));
    }
    session.items = session.items.slice(0, keepUser ? index + 1 : index);
    await this.overlays?.prune(sessionId, session.items);
    await this.#flush(session);
    this.#publish({ type: 'transcript-replaced', sessionId, items: session.items });
    return session.items;
  }

  async fork(sessionId: string, args: CreateSessionArgs): Promise<SessionOpenResult> {
    const source = this.#sessions.get(sessionId);
    const record = this.store.getSession(sessionId);
    if (!record) throw new Error('세션을 찾을 수 없습니다.');
    const created = await this.create({
      ...args,
      title: `${record.title} 분기`,
    });
    const live = this.#sessions.get(created.id);
    if (live && source) {
      const result = await live.connection.tryRequest('x.ai/session/fork', {
        sessionId: source.grokSessionId,
        targetSessionId: live.grokSessionId,
      });
      if (!result.ok) {
        await this.delete(created.id);
        throw new Error(extensionFailure('분기', result));
      }
      live.items = structuredClone(source.items);
      await this.#flush(live);
    }
    const opened = this.openResult(created.id);
    if (!opened) throw new Error('분기한 세션을 열지 못했습니다.');
    return opened;
  }

  setWorkMode(sessionId: string, mode: WorkMode): void {
    const live = this.#sessions.get(sessionId);
    if (live) live.mode = mode;
    const updated = this.store.updateSession(sessionId, { mode });
    if (!updated) throw new Error('세션을 찾을 수 없습니다.');
    this.#publishSummary(sessionId);
  }

  async applyWorktree(sessionId: string): Promise<void> {
    const record = this.store.getSession(sessionId);
    const workspace = record ? this.store.getWorkspace(record.workspaceId) : undefined;
    if (!record?.worktreePath || !workspace) throw new Error('이 세션에는 워크트리가 없습니다.');
    await applyWorktreeToMain(workspace.canonicalRootPath, record.worktreePath);
  }

  forgetChange(sessionId: string, relPath: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    session.changeSummaries = session.changeSummaries.filter((change) => change.relPath !== relPath);
  }

  openResult(sessionId: string): SessionOpenResult | undefined {
    const live = this.#sessions.get(sessionId);
    if (!live) return undefined;
    return this.#toOpenResult(live, 'loaded');
  }

  async prompt(input: {
    sessionId: string;
    text: string;
    attachments: string[];
    tools?: PromptToolFlag[];
    mode?: WorkMode;
    regenerate?: boolean;
    clientItemId?: string;
    sideAsk?: boolean;
  }): Promise<void> {
    const session = this.#requireSession(input.sessionId);
    if (session.running) throw new Error('이미 실행 중인 요청이 있습니다.');
    session.running = true;

    if (input.mode && input.mode !== session.mode) {
      session.mode = input.mode;
      this.store.updateSession(session.id, { mode: input.mode });
    }

    const attachments: string[] = [];
    for (const attachment of input.attachments) {
      try {
        const { relPath } = await resolveWithinRoot(session.cwd, attachment);
        if (classifySensitivity(relPath).sensitive) {
          logger.security('민감한 파일 첨부를 무시했습니다.', { sessionId: session.id, attachment: relPath });
          continue;
        }
        attachments.push(relPath);
      } catch {
        logger.security('작업공간 밖 첨부를 무시했습니다.', { sessionId: session.id, attachment });
      }
    }

    if (input.regenerate) {
      rewindAfterLastUser(session.items);
    } else {
      const visible = input.sideAsk ? `옆 질문: ${input.text}` : input.text;
      const userItem: CachedChatItem = {
        kind: 'user',
        id: input.clientItemId ?? randomUUID(),
        text: maskSecrets(visible),
        at: new Date().toISOString(),
        attachments: attachments.length > 0 ? attachments : undefined,
      };
      session.items.push(userItem);
    }
    const record = this.store.getSession(session.id);
    if (record && record.title === session.workspace.displayName) {
      this.store.updateSession(session.id, { title: titleFromPrompt(input.text) });
      this.#publishSummary(session.id);
    }
    void this.#flush(session);

    const composed = composePromptText({
      mode: session.mode,
      text: input.text,
      attachments,
      instructions: session.workspace.customInstructions,
      tools: input.tools,
      sideAsk: input.sideAsk,
    });

    session.writeAllowance.clear();
    this.store.updateSession(session.id, { status: 'running' });
    this.#broadcast(session.id, { type: 'session-status', sessionId: session.id, status: 'running' });

    try {
      const blocks = await this.#promptBlocks(session, composed, attachments);
      const stopReason = await session.connection.prompt(session.grokSessionId, blocks);
      if (!this.#isCurrent(session)) return;
      this.#broadcast(session.id, {
        type: 'turn-ended',
        sessionId: session.id,
        stopReason: toStopReason(stopReason),
      });
      session.usage.turnsThisSession += 1;
      this.#publishUsage(session);
      // The CLI writes usage as the turn closes; reading it must not hold up the
      // UI, so the header updates again once the numbers land.
      void this.#refreshSessionUsage(session);
      await this.#mergeGitChanges(session);
      if (!this.#isCurrent(session)) return;
      this.#finishTurn(session, 'idle');
    } catch (error) {
      if (!this.#isCurrent(session)) return;
      if (session.cancelRequested) {
        this.#broadcast(session.id, { type: 'turn-ended', sessionId: session.id, stopReason: 'cancelled' });
        this.#finishTurn(session, 'idle');
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const classified = classifyTurnError(message);
      const quota = parseQuota(message);
      if (quota) {
        session.usage.quota = quota;
        this.#publishUsage(session);
      }
      this.#broadcast(session.id, {
        type: 'error',
        sessionId: session.id,
        id: randomUUID(),
        code: classified.code,
        message: classified.message,
        recoverable: true,
        detail: maskSecrets(session.connection.stderrTail),
      });
      this.#broadcast(session.id, { type: 'turn-ended', sessionId: session.id, stopReason: 'error' });
      this.#finishTurn(session, 'failed');
    }
  }

  #publishModels(session: LiveSession): void {
    const state = session.connection.modelState;
    if (!state) return;
    this.#publish({
      type: 'models',
      sessionId: session.id,
      currentModelId: state.currentModelId,
      models: state.availableModels.map((model) => ({
        id: model.modelId,
        name: model.name ?? model.modelId,
        description: model.description ?? undefined,
        contextTokens: model._meta?.totalContextTokens,
      })),
    });
    this.#publishUsage(session);
  }

  #publishUsage(session: LiveSession): void {
    this.#publish({ type: 'usage', sessionId: session.id, usage: { ...session.usage } });
  }

  /** Real token counts for this session, straight from `grok usage`. */
  async #refreshSessionUsage(session: LiveSession): Promise<void> {
    const totals = await readSessionUsage(session.binaryPath, session.grokSessionId, this.grokHomeDir);
    if (!totals) return;
    if (this.#sessions.get(session.id) !== session) return;
    session.usage.session = totals;
    this.#publishUsage(session);
  }

  #finishTurn(session: LiveSession, status: 'idle' | 'failed'): void {
    session.running = false;
    session.cancelRequested = false;
    session.messageId = null;
    session.writeAllowance.clear();
    this.store.updateSession(session.id, { status });
    this.#broadcast(session.id, { type: 'session-status', sessionId: session.id, status });
  }

  #isCurrent(session: LiveSession): boolean {
    return this.#sessions.get(session.id) === session;
  }

  cancel(sessionId: string): void {
    const session = this.#requireSession(sessionId);
    session.cancelRequested = true;
    session.connection.cancel(session.grokSessionId);
    for (const [requestId, pending] of session.pending) {
      pending.resolve({ outcome: 'cancelled' });
      session.pending.delete(requestId);
      this.#publish({ type: 'permission-resolved', sessionId, requestId, decision: 'denied' });
    }
    this.#publish({
      type: 'session-status',
      sessionId,
      status: session.running ? 'running' : 'idle',
    });
    logger.info('사용자가 실행을 중단했습니다.', { sessionId });
  }

  async decide(input: PermissionDecision): Promise<void> {
    const session = this.#requireSession(input.sessionId);
    const pending = session.pending.get(input.requestId);
    if (!pending) throw new Error('이미 처리된 승인 요청입니다.');
    session.pending.delete(input.requestId);

    if (input.scope === 'deny') {
      pending.resolve(this.#rejectOutcome(pending.options));
      this.#recordDecision(session, pending, 'denied');
      return;
    }

    // The renderer's scope wins over whatever id it sent, so a tampered
    // optionId cannot turn a one-off approval into a permanent one.
    const allowOption = pickOption(pending.options, 'allow_once');
    if (!allowOption) {
      pending.resolve({ outcome: 'cancelled' });
      this.#recordDecision(session, pending, 'denied');
      return;
    }

    if (input.scope === 'session' && pending.view.options.some((option) => option.kind === 'allow-session')) {
      session.grants.add(pending.grantKey);
    }
    const mutating = pending.view.kind === 'edit' || pending.view.kind === 'delete' || pending.view.kind === 'move';
    if (mutating) {
      for (const location of pending.locations) {
        if (location.relPath) session.writeAllowance.add(location.relPath);
      }
    }

    pending.resolve({ outcome: 'selected', optionId: allowOption.optionId });
    this.#recordDecision(session, pending, input.scope === 'session' ? 'approved-session' : 'approved-once');
  }

  #recordDecision(
    session: LiveSession,
    pending: PendingPermission,
    decision: 'approved-once' | 'approved-session' | 'denied',
  ): void {
    this.store.recordApproval({
      sessionId: session.id,
      tool: pending.tool,
      target: pending.locations[0]?.relPath,
      command: pending.view.command,
      risk: pending.view.risk,
      decision,
    });
    this.#publish({
      type: 'permission-resolved',
      sessionId: session.id,
      requestId: pending.view.id,
      decision,
    });
    this.#publish({ type: 'session-status', sessionId: session.id, status: 'running' });
    logger.security('승인 결정', {
      sessionId: session.id,
      tool: pending.tool,
      decision,
      risk: pending.view.risk,
      target: pending.locations[0]?.relPath,
    });
  }

  #rejectOutcome(options: RequestPermissionParams['options']): PermissionOutcome {
    const reject = pickOption(options, 'reject_once') ?? pickOption(options, 'reject_always');
    return reject ? { outcome: 'selected', optionId: reject.optionId } : { outcome: 'cancelled' };
  }

  // ---------------------------------------------------------------- delegates

  async #handlePermissionRequest(
    sessionId: string,
    params: RequestPermissionParams,
  ): Promise<PermissionOutcome> {
    const session = this.#requireSession(sessionId);
    // An unlabelled tool is treated as 'other', which never auto-allows.
    const kind = normalizeKind(params.toolCall.kind) ?? 'other';
    const command = extractCommand(params.toolCall.rawInput);
    const locations = await this.#describeLocations(session, params.toolCall);
    const evaluation = evaluatePermission({
      profile: effectiveProfile(session.mode, session.workspace.permissionProfile),
      kind,
      locations,
      command,
      sessionGrants: session.grants,
    });

    const tool = params.toolCall.title ?? kind;

    if (evaluation.decision === 'auto-deny') {
      logger.security('요청을 자동 거부했습니다.', {
        sessionId,
        kind,
        reasons: evaluation.reasons.join(' / '),
      });
      this.#publish({
        type: 'error',
        sessionId,
        code: 'permission-auto-denied',
        message: `자동으로 거부했습니다: ${evaluation.reasons[0] ?? '정책 위반'}`,
        recoverable: true,
      });
      return this.#rejectOutcome(params.options);
    }

    if (evaluation.decision === 'auto-allow') {
      const allow = pickOption(params.options, 'allow_once');
      if (allow) {
        if (kind === 'edit' || kind === 'move') {
          const requestId = randomUUID();
          this.#publish({
            type: 'permission-request',
            sessionId,
            request: {
              id: requestId,
              sessionId,
              toolCallId: params.toolCall.toolCallId,
              kind,
              title: params.toolCall.title ?? describeKind(kind),
              rationale: extractRationale(params.toolCall.rawInput),
              risk: evaluation.risk,
              reasons: evaluation.reasons,
              locations,
              command: command ? maskSecrets(command) : undefined,
              cwd: session.cwd,
              preview: await this.#buildPermissionPreview(session, params.toolCall),
              options: [],
              createdAt: new Date().toISOString(),
            },
          });
          this.#publish({
            type: 'permission-resolved',
            sessionId,
            requestId,
            decision: 'auto-allowed',
          });
        }
        return { outcome: 'selected', optionId: allow.optionId };
      }
    }

    const view: PermissionRequestView = {
      id: randomUUID(),
      sessionId,
      toolCallId: params.toolCall.toolCallId,
      kind,
      title: params.toolCall.title ?? describeKind(kind),
      rationale: extractRationale(params.toolCall.rawInput),
      risk: evaluation.risk,
      reasons: evaluation.reasons,
      locations,
      command: command ? maskSecrets(command) : undefined,
      cwd: session.cwd,
      preview: await this.#buildPermissionPreview(session, params.toolCall),
      options: toDisplayOptions(params.options, evaluation.alwaysAsk),
      createdAt: new Date().toISOString(),
    };

    return new Promise<PermissionOutcome>((resolve) => {
      session.pending.set(view.id, {
        view,
        options: params.options,
        resolve,
        grantKey: evaluation.grantKey,
        locations,
        tool,
      });
      this.store.updateSession(sessionId, { status: 'waiting-approval' });
      this.#publish({ type: 'permission-request', sessionId, request: view });
      this.#publish({ type: 'session-status', sessionId, status: 'waiting-approval' });
    });
  }

  /** Show the exact change before it is applied, when the agent sent one. */
  async #buildPermissionPreview(
    session: LiveSession,
    toolCall: RequestPermissionParams['toolCall'],
  ): Promise<DiffPreview | undefined> {
    for (const content of toolCall.content ?? []) {
      if (content.type !== 'diff' || !('newText' in content)) continue;
      const described = await describePath(session.cwd, content.path).catch(
        () => null,
      );
      if (!described?.insideWorkspace || !described.relPath) continue;
      return buildDiffPreview(
        described.relPath,
        described.canonicalPath,
        content.oldText ?? null,
        content.newText,
      );
    }
    return undefined;
  }

  async #describeLocations(session: LiveSession, toolCall: AcpToolCall | RequestPermissionParams['toolCall']): Promise<ToolLocation[]> {
    const raw = new Set<string>();
    for (const location of toolCall.locations ?? []) raw.add(location.path);
    for (const candidate of extractPaths(toolCall.rawInput)) raw.add(candidate);

    const results: ToolLocation[] = [];
    for (const candidate of raw) {
      try {
        const described = await describePath(session.cwd, candidate);
        results.push({
          path: described.canonicalPath,
          relPath: described.relPath,
          insideWorkspace: described.insideWorkspace,
        });
      } catch {
        results.push({ path: candidate, insideWorkspace: false });
      }
    }
    return results;
  }

  async #handleReadFile(
    sessionId: string,
    params: { sessionId: string; path: string; line?: number; limit?: number },
  ): Promise<string> {
    const session = this.#requireSession(sessionId);
    const { canonicalPath, relPath } = await this.#resolveOrDeny(session, params.path, 'read');

    const sensitivity = classifySensitivity(relPath);
    const pathGrant = grantKeyFor('read', relPath);
    if (sensitivity.sensitive && !session.grants.has(pathGrant)) {
      const approved = await this.#askSynthetic(session, {
        kind: 'read',
        title: `민감한 파일 읽기: ${relPath}`,
        risk: 'high',
        reasons: sensitivity.reasons,
        locations: [{ path: canonicalPath, relPath, insideWorkspace: true }],
        alwaysAsk: true,
        grantKey: pathGrant,
      });
      if (!approved) throw new Error('사용자가 민감한 파일 읽기를 거부했습니다.');
    }

    const content = await readFileCapped(canonicalPath);
    if (params.line === undefined && params.limit === undefined) return content;

    const lines = content.split('\n');
    const start = Math.max(0, (params.line ?? 1) - 1);
    const end = params.limit ? start + params.limit : lines.length;
    return lines.slice(start, end).join('\n');
  }

  async #handleWriteFile(
    sessionId: string,
    params: { sessionId: string; path: string; content: string },
  ): Promise<void> {
    const session = this.#requireSession(sessionId);
    const { canonicalPath, relPath } = await this.#resolveOrDeny(session, params.path, 'edit');

    const profile = effectiveProfile(session.mode, session.workspace.permissionProfile);
    if (profile === 'read-only') {
      throw new Error('현재 모드에서는 파일을 수정할 수 없습니다.');
    }

    const sensitivity = classifySensitivity(relPath);
    const pathGrant = grantKeyFor('edit', relPath);
    const trustedAuto = profile === 'trusted' && !sensitivity.sensitive;
    const preApproved =
      trustedAuto || session.writeAllowance.has(relPath) || session.grants.has(pathGrant);
    if (!preApproved) {
      const before = await readFileCapped(canonicalPath).catch(() => null);
      const approved = await this.#askSynthetic(session, {
        kind: 'edit',
        title: `파일 쓰기: ${relPath}`,
        risk: sensitivity.sensitive ? 'high' : 'medium',
        reasons: sensitivity.sensitive
          ? sensitivity.reasons
          : ['에이전트가 승인 없이 파일 쓰기를 시도했습니다.'],
        locations: [{ path: canonicalPath, relPath, insideWorkspace: true }],
        preview: buildDiffPreview(relPath, canonicalPath, before, params.content),
        alwaysAsk: sensitivity.sensitive,
        grantKey: pathGrant,
      });
      if (!approved) throw new Error('사용자가 파일 쓰기를 거부했습니다.');
    }

    await this.changes.captureBefore(session.id, canonicalPath, relPath);
    await mkdir(path.dirname(canonicalPath), { recursive: true });
    await writeFile(canonicalPath, params.content, 'utf8');
    const change = await this.changes.recordAfter(session.id, canonicalPath, relPath);
    this.#publish({ type: 'file-changed', sessionId: session.id, change });
    logger.info('파일을 변경했습니다.', { sessionId: session.id, relPath, status: change.status });
  }

  async #resolveOrDeny(
    session: LiveSession,
    target: string,
    kind: ToolKind,
  ): Promise<{ canonicalPath: string; relPath: string }> {
    try {
      return await resolveWithinRoot(session.cwd, target);
    } catch (error) {
      if (error instanceof PathEscapeError) {
        logger.security('작업공간 밖 파일 접근을 차단했습니다.', {
          sessionId: session.id,
          kind,
          target,
        });
        this.#publish({
          type: 'error',
          sessionId: session.id,
          code: 'path-escape',
          message: `작업공간 밖 경로에 대한 ${describeKind(kind)} 요청을 차단했습니다: ${target}`,
          recoverable: true,
        });
      }
      throw error;
    }
  }

  /** Approval prompt raised by the app itself, not by the agent. */
  async #askSynthetic(
    session: LiveSession,
    input: {
      kind: ToolKind;
      title: string;
      risk: RiskLevel;
      reasons: string[];
      locations: ToolLocation[];
      preview?: DiffPreview;
      alwaysAsk?: boolean;
      grantKey?: string;
    },
  ): Promise<boolean> {
    const view: PermissionRequestView = {
      id: randomUUID(),
      sessionId: session.id,
      kind: input.kind,
      title: input.title,
      risk: input.risk,
      reasons: input.reasons,
      locations: input.locations,
      preview: input.preview,
      cwd: session.cwd,
      options: toDisplayOptions([], Boolean(input.alwaysAsk)),
      createdAt: new Date().toISOString(),
    };

    const outcome = await new Promise<PermissionOutcome>((resolve) => {
      session.pending.set(view.id, {
        view,
        options: [
          { optionId: 'app-allow', kind: 'allow_once', name: '허용' },
          { optionId: 'app-reject', kind: 'reject_once', name: '거부' },
        ],
        resolve,
        grantKey: input.grantKey ?? grantKeyFor(input.kind),
        locations: input.locations,
        tool: input.kind,
      });
      this.#publish({ type: 'permission-request', sessionId: session.id, request: view });
      this.#publish({ type: 'session-status', sessionId: session.id, status: 'waiting-approval' });
    });

    return outcome.outcome === 'selected' && outcome.optionId === 'app-allow';
  }

  #handleUpdate(sessionId: string, update: AcpSessionUpdate): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;

    switch (update.kind) {
      case 'agent-message':
      case 'agent-thought': {
        if (!session.messageId) session.messageId = randomUUID();
        this.#publish({
          type: 'message-delta',
          sessionId,
          messageId: session.messageId,
          channel: update.kind === 'agent-message' ? 'answer' : 'thought',
          text: maskSecrets(update.text),
        });
        return;
      }
      case 'plan':
        this.#publish({
          type: 'plan',
          sessionId,
          id: 'plan',
          entries: update.entries.map((entry) => ({
            content: entry.content,
            status: entry.status === 'in_progress' ? 'in-progress' : entry.status,
            priority: entry.priority,
          })),
        });
        return;
      case 'tool-call':
        void this.#handleToolCall(session, update.call);
        return;
      case 'subagent':
        this.#publish({
          type: 'subagent',
          sessionId,
          id: update.id,
          title: update.title,
          status: update.phase === 'finished' ? 'completed' : 'running',
          detail: update.detail,
        });
        return;
      case 'task':
        this.#publish({
          type: 'background-task',
          sessionId,
          id: update.id,
          title: update.title,
          status: update.phase === 'completed' ? 'completed' : 'running',
        });
        return;
      case 'mode':
      case 'user-message':
        return;
      case 'unsupported':
        logger.debug('지원하지 않는 session/update 유형', {
          sessionId,
          sessionUpdate: update.sessionUpdate,
        });
        return;
      default:
        return;
    }
  }

  async #handleToolCall(session: LiveSession, call: AcpToolCall): Promise<void> {
    const existing = session.toolCalls.get(call.toolCallId);
    const kind = normalizeKind(call.kind) ?? existing?.kind ?? 'other';
    const locations = await this.#describeLocations(session, call);
    const command = extractCommand(call.rawInput);

    const textOutput = (call.content ?? [])
      .map((entry) => {
        if (entry.type === 'content' && 'content' in entry) {
          const block = entry.content;
          return block && typeof block === 'object' && 'text' in block ? String(block.text) : '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');

    const view: ToolCallView = {
      id: call.toolCallId,
      kind,
      title: call.title ?? existing?.title ?? describeKind(kind),
      status: mapToolStatus(call.status) ?? existing?.status ?? 'in-progress',
      locations: locations.length > 0 ? locations : (existing?.locations ?? []),
      command: command ? maskSecrets(command) : existing?.command,
      cwd: session.cwd,
      output: textOutput ? maskSecrets(textOutput) : existing?.output,
      media: extractToolMedia(call, existing?.media, textOutput),
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      endedAt:
        mapToolStatus(call.status) === 'completed' || mapToolStatus(call.status) === 'failed'
          ? new Date().toISOString()
          : undefined,
    };

    session.toolCalls.set(view.id, view);
    this.#publish({ type: 'tool-call', sessionId: session.id, call: view });

    if (kind === 'execute' && textOutput) {
      const previousLength = existing?.output?.length ?? 0;
      const delta = textOutput.slice(previousLength);
      if (delta) {
        this.#publish({
          type: 'terminal-output',
          sessionId: session.id,
          toolCallId: view.id,
          stream: 'stdout',
          chunk: maskSecrets(delta),
        });
      }
    }

    // Diffs the agent reports for files it edited with its own tools.
    for (const content of call.content ?? []) {
      if (content.type !== 'diff' || !('newText' in content)) continue;
      const described = await describePath(session.cwd, content.path).catch(
        () => null,
      );
      if (!described?.insideWorkspace || !described.relPath) continue;
      const preview = buildDiffPreview(
        described.relPath,
        described.canonicalPath,
        content.oldText ?? null,
        content.newText,
      );
      this.#publish({
        type: 'file-changed',
        sessionId: session.id,
        change: {
          path: described.canonicalPath,
          relPath: described.relPath,
          status: content.oldText ? 'modified' : 'added',
          additions: preview.additions,
          deletions: preview.deletions,
          revertable: this.changes.isRevertable(session.id, described.relPath),
        },
      });
    }
  }

  async #promptBlocks(
    session: LiveSession,
    text: string,
    attachments: string[],
  ): Promise<Array<{ type: 'text'; text: string } | { type: 'image'; mimeType?: string; data?: string }>> {
    const blocks: Array<{ type: 'text'; text: string } | { type: 'image'; mimeType?: string; data?: string }> = [
      { type: 'text', text },
    ];
    for (const relPath of attachments) {
      const kind = mediaKindFor(relPath);
      if (!kind || kind.kind !== 'image') continue;
      try {
        const media = await readMedia(session.cwd, relPath);
        const data = media.dataUrl.split(',')[1];
        if (data) blocks.push({ type: 'image', mimeType: media.mimeType, data });
      } catch (error) {
        logger.warn('이미지 첨부를 읽지 못했습니다.', { relPath, reason: String(error) });
      }
    }
    return blocks;
  }

  #requireSession(sessionId: string): LiveSession {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error('세션을 찾을 수 없습니다. 폴더를 다시 열어 주세요.');
    return session;
  }

  async disposeSession(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    await this.#park(session, 'idle');
  }

  async disposeAll(): Promise<void> {
    await this.#parkAll();
  }

  #buildConnection(
    recordId: string,
    workspace: WorkspaceRecord,
    args: { binaryPath: string; includeApiKey?: boolean; args?: string[]; model?: string },
  ): GrokAgentConnection {
    const connection = new GrokAgentConnection({
      binaryPath: args.binaryPath,
      args: args.args,
      model: args.model,
      sandbox: workspace.sandbox,
      includeApiKey: args.includeApiKey,
      onSpawn: (pid) => this.orphans?.register(pid),
      onExit: (pid) => this.orphans?.release(pid),
      cwd: workspace.canonicalRootPath,
      delegate: {
        onSessionUpdate: (_grokSessionId, update) => this.#handleUpdate(recordId, update),
        onRequestPermission: (params) => this.#handlePermissionRequest(recordId, params),
        readTextFile: (params) => this.#handleReadFile(recordId, params),
        writeTextFile: (params) => this.#handleWriteFile(recordId, params),
        onStderr: (line) => logger.debug(`[grok stderr] ${line}`, { sessionId: recordId }),
        onStateChange: (state, detail) => {
          if (state === 'failed') {
            const live = this.#sessions.get(recordId);
            if (!live || live.connection !== connection) return;
            this.store.updateSession(recordId, { status: 'failed' });
            this.#publish({
              type: 'error',
              sessionId: recordId,
              id: randomUUID(),
              code: 'agent-exited',
              message: detail ?? 'Grok CLI 연결이 끊어졌습니다.',
              recoverable: true,
            });
            this.#publish({ type: 'session-status', sessionId: recordId, status: 'failed', detail });
          }
        },
      },
    });
    return connection;
  }

  #toOpenResult(session: LiveSession, agentContext: AgentContext): SessionOpenResult {
    const record = this.store.getSession(session.id);
    return {
      session: {
        ...(record ?? {
          id: session.id,
          grokSessionId: session.grokSessionId,
          workspaceId: session.workspace.id,
          title: session.workspace.displayName,
          mode: session.mode,
          status: 'idle' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        workspace: toWorkspaceSummary(session.workspace),
        live: true,
      },
      items: session.items,
      changes: session.changeSummaries,
      agentContext,
    };
  }

  #publishSummary(sessionId: string): void {
    const record = this.store.getSession(sessionId);
    if (!record) return;
    const workspace = this.store.getWorkspace(record.workspaceId);
    if (!workspace) return;
    this.#publish({
      type: 'session-updated',
      session: { ...record, workspace: toWorkspaceSummary(workspace), live: this.#sessions.has(sessionId) },
    });
  }

  async #loadPersistedItems(record: {
    id: string;
    grokSessionId?: string;
    workspaceId: string;
  }): Promise<{ items: CachedChatItem[]; changes: FileChangeSummary[] }> {
    const workspace = this.store.getWorkspace(record.workspaceId);
    let items: CachedChatItem[] = [];
    let changes: FileChangeSummary[] = [];
    let fromCli = false;
    if (record.grokSessionId && workspace) {
      const cli = await findCliSession(workspace.canonicalRootPath, record.grokSessionId, this.grokHomeDir);
      if (cli) {
        const replayed = await replayCliTranscript(cli.directory);
        items = replayed.items;
        changes = replayed.changes;
        fromCli = items.length > 0;
      }
    }
    if (!fromCli) {
      const cache = await this.transcripts.load(record.id);
      items = cache.items;
      if (changes.length === 0) changes = cache.changes;
    } else if (this.overlays) {
      // Overlay is app-only events. The UI cache already includes them.
      items = await this.overlays.apply(record.id, items);
    }
    return { items, changes };
  }

  #publish(event: SessionEvent): void {
    const sessionId =
      event.type === 'session-updated'
        ? event.session.id
        : 'sessionId' in event
          ? event.sessionId
          : undefined;
    if (sessionId) {
      const session = this.#sessions.get(sessionId);
      if (session) {
        session.items = applyTranscriptEvent(session.items, event);
        if (event.type === 'file-changed') {
          session.changeSummaries = upsertChange(session.changeSummaries, event.change);
        }
        if (shouldFlushTranscript(event)) void this.#flush(session);
        else this.#scheduleFlush(session);
      }
    }
    if (sessionId) void this.overlays?.append(sessionId, event);
    this.emit(event);
  }

  /** Kept for call-site readability: the session id is carried by the event. */
  #broadcast(_sessionId: string, event: SessionEvent): void {
    this.#publish(event);
  }

  #scheduleFlush(session: LiveSession): void {
    if (this.#flushTimers.has(session.id)) return;
    const timer = setTimeout(() => {
      this.#flushTimers.delete(session.id);
      void this.#flush(session);
    }, 400);
    timer.unref?.();
    this.#flushTimers.set(session.id, timer);
  }

  async #flush(session: LiveSession): Promise<void> {
    const timer = this.#flushTimers.get(session.id);
    if (timer) {
      clearTimeout(timer);
      this.#flushTimers.delete(session.id);
    }
    await this.transcripts.save(session.id, {
      version: 1,
      items: session.items,
      changes: session.changeSummaries,
    });
  }

  async #park(session: LiveSession, status: 'idle' | 'closed' | 'failed'): Promise<void> {
    if (session.running) {
      session.cancelRequested = true;
      session.connection.cancel(session.grokSessionId);
      session.running = false;
    }
    for (const [requestId, pending] of session.pending) {
      pending.resolve({ outcome: 'cancelled' });
      session.items = applyTranscriptEvent(session.items, {
        type: 'permission-resolved',
        sessionId: session.id,
        requestId,
        decision: 'denied',
      });
      this.#publish({ type: 'permission-resolved', sessionId: session.id, requestId, decision: 'denied' });
    }
    session.pending.clear();
    await this.#flush(session);
    this.changes.clearSession(session.id);
    this.#sessions.delete(session.id);
    this.store.updateSession(session.id, { status, grokSessionId: session.grokSessionId });
    await session.connection.dispose().catch(() => undefined);
    this.#publish({ type: 'session-status', sessionId: session.id, status });
    this.#publishSummary(session.id);
  }

  async #mergeGitChanges(session: LiveSession): Promise<void> {
    const extras = await collectGitChanges(session.cwd);
    for (const extra of extras) {
      if (session.changeSummaries.some((change) => change.relPath === extra.relPath)) continue;
      const change = {
        path: `${session.cwd}/${extra.relPath}`,
        relPath: extra.relPath,
        status: extra.status,
        additions: 0,
        deletions: 0,
        revertable: false,
      };
      session.changeSummaries = upsertChange(session.changeSummaries, change);
      this.#publish({ type: 'file-changed', sessionId: session.id, change });
    }
  }

  async #parkAll(): Promise<void> {
    await Promise.all([...this.#sessions.values()].map((session) => this.#park(session, 'idle')));
  }

  async #sessionCwd(
    record: { worktreePath?: string },
    workspace: WorkspaceRecord,
  ): Promise<string> {
    if (!record.worktreePath) return workspace.canonicalRootPath;
    try {
      await access(record.worktreePath);
      return record.worktreePath;
    } catch {
      logger.warn('워크트리가 없어 원래 폴더로 재개합니다.', { worktreePath: record.worktreePath });
      return workspace.canonicalRootPath;
    }
  }

  /**
   * Keep several ACP children alive. Only park idle ones when we hit the cap
   * so switching conversations does not kill a running agent.
   */
  async #ensureLiveCapacity(): Promise<void> {
    const maxLive = 4;
    const live = [...this.#sessions.values()];
    if (live.length < maxLive) return;
    const parkable = live.filter((session) => !session.running && session.pending.size === 0);
    const needed = live.length - maxLive + 1;
    if (parkable.length < needed) {
      throw new Error(
        '세션을 더 연결하려면 실행 중이 아닌 대화를 먼저 중지하십시오. 동시에 유지하는 실시간 연결은 4개입니다.',
      );
    }
    await Promise.all(parkable.slice(0, needed).map((session) => this.#park(session, 'idle')));
  }

  #pruneWorkspaceSessions(workspaceId: string): void {
    const records = this.store
      .listSessions()
      .filter((session) => session.workspaceId === workspaceId && session.status !== 'closed');
    if (records.length < MAX_SESSIONS_PER_WORKSPACE) return;
    for (const extra of records.slice(MAX_SESSIONS_PER_WORKSPACE - 1)) {
      if (this.#sessions.has(extra.id)) continue;
      if (extra.grokSessionId) continue;
      this.store.updateSession(extra.id, { status: 'closed' });
    }
  }
}

// -------------------------------------------------------------------- helpers

function toWorkspaceSummary(workspace: WorkspaceRecord) {
  return {
    id: workspace.id,
    displayName: workspace.displayName,
    rootPath: workspace.rootPath,
    canonicalRootPath: workspace.canonicalRootPath,
    permissionProfile: workspace.permissionProfile,
    customInstructions: workspace.customInstructions,
    sandbox: workspace.sandbox,
    lastSessionId: workspace.lastSessionId,
    lastOpenedAt: workspace.lastOpenedAt,
  };
}

function pickOption(
  options: RequestPermissionParams['options'],
  kind: NonNullable<RequestPermissionParams['options'][number]['kind']>,
) {
  return options.find((option) => option.kind === kind);
}

function toDisplayOptions(
  agentOptions: RequestPermissionParams['options'],
  alwaysAsk: boolean,
): PermissionOption[] {
  const options: PermissionOption[] = [{ optionId: 'once', name: '이번 한 번 허용', kind: 'allow-once' }];
  // Session-wide allowance is never offered for the families spec 6.5 lists.
  const supportsSession =
    !alwaysAsk && (agentOptions.length === 0 || agentOptions.some((option) => option.kind !== undefined));
  if (supportsSession) {
    options.push({ optionId: 'session', name: '이 세션 동안 같은 도구 허용', kind: 'allow-session' });
  }
  options.push({ optionId: 'deny', name: '거부', kind: 'reject-once' });
  return options;
}

/**
 * Returns undefined when the agent did not state a kind, so a follow-up
 * `tool_call_update` cannot downgrade an already-known 'read' back to 'other'.
 */
export function normalizeKind(kind: string | undefined): ToolKind | undefined {
  switch (kind) {
    case 'read':
    case 'search':
    case 'edit':
    case 'delete':
    case 'move':
    case 'execute':
    case 'fetch':
    case 'think':
      return kind;
    case undefined:
      return undefined;
    default:
      return 'other';
  }
}

function mapToolStatus(status: string | undefined): ToolCallView['status'] | undefined {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'in_progress':
      return 'in-progress';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return undefined;
  }
}

function extractToolMedia(
  call: AcpToolCall,
  existing: ToolMedia[] | undefined,
  textOutput: string,
): ToolMedia[] | undefined {
  const found: ToolMedia[] = [...(existing ?? [])];
  for (const entry of call.content ?? []) {
    if (entry.type !== 'content' || !('content' in entry)) continue;
    const block = entry.content;
    if (!block || typeof block !== 'object') continue;
    if ('type' in block && block.type === 'image' && 'data' in block && typeof block.data === 'string') {
      const mimeType = 'mimeType' in block && typeof block.mimeType === 'string' ? block.mimeType : 'image/png';
      found.push({
        kind: 'image',
        mimeType,
        dataUrl: `data:${mimeType};base64,${block.data}`,
      });
    }
  }
  for (const match of textOutput.matchAll(/[\w./-]+\.(png|jpe?g|gif|webp|mp4|webm)/gi)) {
    const relPath = match[0];
    const kind = mediaKindFor(relPath);
    if (!kind) continue;
    if (!found.some((entry) => entry.relPath === relPath)) {
      found.push({ kind: kind.kind, relPath, mimeType: kind.mime });
    }
  }
  return found.length > 0 ? found : undefined;
}

function itemsToMarkdown(title: string, items: CachedChatItem[]): string {
  const lines = [`# ${title}`, ''];
  for (const item of items) {
    switch (item.kind) {
      case 'user':
        lines.push('## 사용자', '', item.text, '');
        if (item.attachments?.length) {
          lines.push(`첨부: ${item.attachments.join(', ')}`, '');
        }
        break;
      case 'message':
        if (item.channel === 'thought') continue;
        lines.push('## Grok', '', item.text, '');
        break;
      case 'tool':
        lines.push(`- 도구: ${item.call.title} (${item.call.status})`);
        break;
      case 'error':
        lines.push(`- 오류: ${item.message}`);
        break;
      default:
        break;
    }
  }
  return lines.join('\n').trim() + '\n';
}

/**
 * The 429 body is the only place the API tells us real numbers, e.g.
 * `tokens (actual/limit): 508641/500000`. Everything else about remaining
 * usage would be guesswork, so nothing else is invented.
 */
export function parseQuota(message: string): UsageSnapshot['quota'] | undefined {
  const match = /tokens\s*\(actual\/limit\)\s*:\s*(\d+)\s*\/\s*(\d+)/i.exec(message);
  const used = match?.[1];
  const limit = match?.[2];
  if (!used || !limit) return undefined;
  return {
    usedTokens: Number(used),
    limitTokens: Number(limit),
    observedAt: new Date().toISOString(),
  };
}

function initialUsage(connection: GrokAgentConnection, requestedModel?: string): UsageSnapshot {
  const state = connection.modelState;
  const modelId = requestedModel ?? state?.currentModelId;
  const current = state?.availableModels.find((model) => model.modelId === modelId);
  return {
    modelId,
    contextTokens: current?._meta?.totalContextTokens,
    turnsThisSession: 0,
  };
}

function rewindAfterLastUser(items: CachedChatItem[]): void {
  let lastUser = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.kind === 'user') {
      lastUser = index;
      break;
    }
  }
  if (lastUser === -1) return;
  items.splice(lastUser + 1);
}

const FILE_READ_CAP = 2 * 1024 * 1024;

async function readFileCapped(canonicalPath: string): Promise<string> {
  const handle = await open(canonicalPath, 'r');
  try {
    const stat = await handle.stat();
    const size = Math.min(stat.size, FILE_READ_CAP);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, 0);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

export function classifyTurnError(message: string): { code: string; message: string } {
  if (/free-usage-exhausted|usage.?limit|quota|429|rate.?limit/i.test(message)) {
    return {
      code: 'quota-exceeded',
      message:
        'xAI 사용 한도에 도달했습니다. 구독을 방금 변경했다면 `grok logout && grok login` 으로 다시 로그인해야 새 등급이 적용됩니다. 한도는 24시간 롤링 기준으로 회복됩니다.',
    };
  }
  if (/(xai|grok).*(auth|login|credential)|unauthoriz|authentication required|invalid.?api.?key|401\b/i.test(message)) {
    return { code: 'auth-required', message: 'xAI 인증이 만료되었습니다. 다시 로그인해 주세요.' };
  }
  if (/timed out|timeout|ETIMEDOUT/i.test(message)) {
    return { code: 'timeout', message: '응답이 시간 안에 오지 않았습니다. 다시 시도해 주세요.' };
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|network|offline/i.test(message)) {
    return { code: 'network', message: '네트워크에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.' };
  }
  return { code: 'prompt-failed', message };
}

function toStopReason(value: string): StopReason {
  switch (value) {
    case 'end_turn':
    case 'max_tokens':
    case 'max_turn_requests':
    case 'refusal':
    case 'cancelled':
      return value;
    default:
      return 'end_turn';
  }
}

function describeKind(kind: ToolKind): string {
  const labels: Record<ToolKind, string> = {
    read: '파일 읽기',
    search: '검색',
    edit: '파일 수정',
    delete: '파일 삭제',
    move: '파일 이동',
    execute: '명령 실행',
    fetch: '외부 데이터 가져오기',
    think: '사고 과정',
    other: '도구 실행',
  };
  return labels[kind];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function extractCommand(rawInput: unknown): string | undefined {
  const record = asRecord(rawInput);
  if (!record) return undefined;
  for (const key of ['command', 'cmd', 'shellCommand', 'script']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return value.join(' ');
    }
  }
  return undefined;
}

export function extractPaths(rawInput: unknown): string[] {
  const record = asRecord(rawInput);
  if (!record) return [];
  const paths: string[] = [];
  for (const key of ['path', 'file_path', 'filePath', 'target', 'destination', 'source']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) paths.push(value);
  }
  const list = record.paths ?? record.files;
  if (Array.isArray(list)) {
    for (const item of list) if (typeof item === 'string') paths.push(item);
  }
  return paths;
}

function extractRationale(rawInput: unknown): string | undefined {
  const record = asRecord(rawInput);
  if (!record) return undefined;
  for (const key of ['description', 'reason', 'explanation', 'why']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return maskSecrets(value);
  }
  return undefined;
}
