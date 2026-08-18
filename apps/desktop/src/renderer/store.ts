import { create } from 'zustand';
import type {
  AuthStatus,
  CachedChatItem,
  DiffResult,
  FileChangeSummary,
  DiffScope,
  ModelInfo,
  PromptToolFlag,
  RuntimeStatus,
  SessionEvent,
  SessionOpenResult,
  SessionStatus,
  SessionSummary,
  TreeNode,
  UsageSnapshot,
  WorkMode,
  WorkspaceCandidate,
  WorkspaceSummary,
} from '@grok-desktop/shared';
import { applyTranscriptEvent } from '@grok-desktop/shared';
import { ancestorDirs, parentDir } from './path-links.js';
import {
  loadPrefs,
  loadRecentFiles,
  rememberPath,
  saveIsolation,
  savePinnedIds,
  saveRecentFiles,
  saveViewMode,
  toggleId,
  type IsolationPref,
} from './prefs.js';

export type ChatItem = CachedChatItem;

export type QueuedPrompt = {
  id: string;
  text: string;
  attachments: string[];
  tools: PromptToolFlag[];
  sideAsk?: boolean;
};

type State = {
  runtime: RuntimeStatus | null;
  auth: AuthStatus | null;
  recents: WorkspaceSummary[];
  sessions: SessionSummary[];
  workspace: WorkspaceSummary | null;
  session: SessionSummary | null;
  mode: WorkMode;
  status: SessionStatus;
  items: ChatItem[];
  /** Messages typed while the agent was busy, sent in order once it is idle. */
  queue: QueuedPrompt[];
  changes: FileChangeSummary[];
  tree: Record<string, TreeNode[]>;
  expanded: string[];
  activeDiff: DiffResult | null;
  pendingConfirmation: WorkspaceCandidate | null;
  models: ModelInfo[];
  currentModelId: string | null;
  usage: UsageSnapshot | null;
  busy: boolean;
  notice: string | null;
  attachments: string[];
  tools: PromptToolFlag[];
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  draft: string;
  drafts: Record<string, string>;
  confirm: { title: string; message: string } | null;
  noticeKind: 'info' | 'warn' | 'error';
  filePreview: { relPath: string; text: string; truncated: boolean; masked: boolean; line?: number; originalText: string } | null;
  followOutput: boolean;
  reviewOpen: boolean;
  reviewScope: NonNullable<DiffScope> | 'turn';
  reviewComments: { relPath: string; line: string; text: string }[];
  viewMode: 'normal' | 'verbose' | 'summary';
  localhostPreview: string | null;
  splitSession: SessionSummary | null;
  splitItems: ChatItem[];
  splitStatus: SessionStatus;
  sessionInfo: {
    id: string;
    grokSessionId?: string;
    cwd: string;
    model?: string;
    worktreeLabel?: string;
    messageCount: number;
    branch?: string;
  } | null;
  sideAskOpen: boolean;
  attentionIds: string[];
  fileSwitcherOpen: boolean;
  fileSwitcherMode: 'files' | 'commands';
  sidebarTab: 'sessions' | 'files' | 'changes' | 'tasks';
  fileSearchFocus: number;
  gitBranch: string | null;
  pinnedIds: string[];
  recentFiles: string[];
  revealedFile: string | null;
  lastIsolation: IsolationPref;
  mediaLightbox: { src: string; alt: string } | null;
};

type Actions = {
  bootstrap: () => Promise<void>;
  refreshRuntime: () => Promise<void>;
  startLogin: () => Promise<void>;
  chooseFolder: (confirmedPath?: string) => Promise<void>;
  openRecent: (workspaceId: string) => Promise<void>;
  newSession: (isolation?: IsolationPref) => Promise<void>;
  revealInTree: (relPath: string, opts?: { show?: boolean; directory?: boolean }) => Promise<void>;
  copyFilePreview: () => Promise<void>;
  previewRecent: (delta: number) => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  restartSession: () => Promise<void>;
  setMode: (mode: WorkMode) => void;
  setModel: (modelId: string) => Promise<void>;
  send: (
    text: string,
    attachments: string[],
    tools?: PromptToolFlag[],
    opts?: { sideAsk?: boolean },
  ) => Promise<boolean>;
  openPath: (relPath: string) => Promise<void>;
  enqueue: (text: string, attachments: string[], tools?: PromptToolFlag[], opts?: { sideAsk?: boolean }) => void;
  addAttachments: (relPaths: string[]) => void;
  removeAttachment: (relPath: string) => void;
  toggleTool: (tool: PromptToolFlag) => void;
  pickAttachments: () => Promise<void>;
  dropFiles: (files: File[]) => Promise<void>;
  pasteImages: (files: File[]) => Promise<void>;
  attachFromTree: (relPath: string) => void;
  updateWorkspace: (patch: {
    permissionProfile?: WorkspaceSummary['permissionProfile'];
    customInstructions?: string | null;
    sandbox?: WorkspaceSummary['sandbox'];
  }) => Promise<void>;
  exportConversation: () => Promise<string | null>;
  copyLastAnswer: () => Promise<void>;
  regenerate: () => Promise<void>;
  setSettingsOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  notify: (message: string, kind?: 'info' | 'warn' | 'error') => void;
  setDraft: (text: string) => void;
  askConfirm: (title: string, message: string) => Promise<boolean>;
  answerConfirm: (ok: boolean) => void;
  previewFile: (relPath: string, line?: number) => Promise<void>;
  closeFilePreview: () => Promise<void>;
  copyPath: (relPath: string) => Promise<void>;
  setFileSwitcherOpen: (open: boolean, mode?: State['fileSwitcherMode']) => void;
  setSidebarTab: (tab: State['sidebarTab']) => void;
  openFileSearch: () => void;
  restoreQueued: (id: string) => void;
  togglePin: (sessionId: string) => void;
  setLastIsolation: (value: IsolationPref) => void;
  promoteQueued: (id: string) => void;
  sendQueuedNow: (id: string) => void;
  openMediaLightbox: (media: { src: string; alt: string }) => void;
  closeMediaLightbox: () => void;
  stageAll: () => Promise<void>;
  revertAll: () => Promise<void>;
  setFollowOutput: (follow: boolean) => void;
  removeQueued: (id: string) => void;
  flushQueue: () => void;
  cancel: () => Promise<void>;
  decide: (requestId: string, scope: 'once' | 'session' | 'deny') => Promise<void>;
  toggleDirectory: (relPath: string) => Promise<void>;
  showDiff: (relPath: string, scope?: NonNullable<DiffScope> | 'turn') => Promise<void>;
  closeDiff: () => void;
  revert: (relPath: string) => Promise<void>;
  setReviewOpen: (open: boolean) => Promise<void>;
  setReviewScope: (scope: NonNullable<DiffScope> | 'turn') => Promise<void>;
  addReviewComment: (relPath: string, line: string, text: string) => void;
  submitReview: () => Promise<void>;
  continuePlan: () => Promise<void>;
  listReviewFiles: () => Promise<FileChangeSummary[]>;
  openExternal: (url: string) => Promise<void>;
  dismissNotice: () => void;
  ingest: (event: SessionEvent) => void;
  setViewMode: (mode: 'normal' | 'verbose' | 'summary') => void;
  saveFilePreview: () => Promise<void>;
  revealPath: (relPath: string) => Promise<void>;
  rewindTo: (userItemId: string) => Promise<void>;
  editUserMessage: (userItemId: string) => Promise<void>;
  forkSession: () => Promise<void>;
  applyWorktree: () => Promise<void>;
  exportRaw: () => Promise<void>;
  loadExtras: () => Promise<{
    mcp: { name: string; enabled: boolean }[];
    skills: { name: string; source: string; enabled: boolean }[];
  }>;
  toggleExtra: (
    kind: 'mcp' | 'skill',
    name: string,
    enabled: boolean,
  ) => Promise<{
    mcp: { name: string; enabled: boolean }[];
    skills: { name: string; source: string; enabled: boolean }[];
  }>;
  commitChanges: (message: string) => Promise<void>;
  exportLog: () => Promise<void>;
  loadSessionInfo: () => Promise<void>;
  pushChanges: () => Promise<void>;
  createPullRequest: (title: string, body: string) => Promise<void>;
  openLocalhostPreview: (url: string) => void;
  closeLocalhostPreview: () => void;
  openSplitSession: (sessionId: string) => Promise<void>;
  closeSplitSession: () => void;
  focusSplitSession: () => Promise<void>;
  setSideAskOpen: (open: boolean) => void;
  sideAsk: (text: string) => void;
};

const bridge = () => window.grokDesktop;

let counter = 0;
const nextId = () => `local-${(counter += 1)}`;
let confirmResolver: ((ok: boolean) => void) | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let revealTreeSeq = 0;
let filesChangedThisTurn = false;
let decideInFlight = false;
const treeRefreshQueued = new Set<string>();

function queueTreeRefresh(dirs: string[]): void {
  for (const dir of dirs) treeRefreshQueued.add(dir);
  if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
  treeRefreshTimer = setTimeout(() => {
    const pending = [...treeRefreshQueued];
    treeRefreshQueued.clear();
    treeRefreshTimer = null;
    const workspace = useStore.getState().workspace;
    if (!workspace || pending.length === 0) return;
    const workspaceId = workspace.id;
    void Promise.all(
      pending.map(async (relPath) => {
        const nodes = await window.grokDesktop.workspace.readTree({ workspaceId, relPath });
        return [relPath, nodes] as const;
      }),
    )
      .then((entries) => {
        if (useStore.getState().workspace?.id !== workspaceId) return;
        useStore.setState((state) => {
          const tree = { ...state.tree };
          for (const [relPath, nodes] of entries) tree[relPath] = nodes;
          return { tree };
        });
      })
      .catch(() => undefined);
  }, 80);
}

async function abandonFilePreview(get: () => State & Actions): Promise<boolean> {
  const preview = get().filePreview;
  if (!preview || preview.text === preview.originalText) return true;
  return get().askConfirm('저장하지 않은 변경', `${preview.relPath} 수정을 저장하지 않고 닫을까요?`);
}

function stashDraft(get: () => State & Actions, set: (partial: Partial<State>) => void): void {
  const { session, draft, drafts } = get();
  if (!session) return;
  set({ drafts: { ...drafts, [session.id]: draft } });
}

const initialPrefs = loadPrefs();

export const useStore = create<State & Actions>((set, get) => ({
  runtime: null,
  auth: null,
  recents: [],
  sessions: [],
  workspace: null,
  session: null,
  mode: 'ask',
  status: 'idle',
  items: [],
  queue: [],
  changes: [],
  tree: {},
  expanded: [],
  activeDiff: null,
  pendingConfirmation: null,
  models: [],
  currentModelId: null,
  usage: null,
  busy: false,
  notice: null,
  attachments: [],
  tools: [],
  settingsOpen: false,
  shortcutsOpen: false,
  draft: '',
  drafts: {},
  confirm: null,
  noticeKind: 'info',
  filePreview: null,
  followOutput: true,
  reviewOpen: false,
  reviewScope: 'working',
  reviewComments: [],
  localhostPreview: null,
  splitSession: null,
  splitItems: [],
  splitStatus: 'idle',
  sessionInfo: null,
  sideAskOpen: false,
  attentionIds: [],
  fileSwitcherOpen: false,
  fileSwitcherMode: 'files',
  sidebarTab: 'sessions',
  fileSearchFocus: 0,
  gitBranch: null,
  pinnedIds: initialPrefs.pinnedIds,
  recentFiles: [],
  revealedFile: null,
  lastIsolation: initialPrefs.lastIsolation,
  viewMode: initialPrefs.viewMode,
  mediaLightbox: null,

  async bootstrap() {
    const [runtime, auth, recents] = await Promise.all([
      bridge().runtime.getStatus(),
      bridge().auth.getStatus(),
      bridge().workspace.listRecent(),
    ]);
    set({ runtime, auth, recents });
  },

  async refreshRuntime() {
    const [runtime, auth] = await Promise.all([
      bridge().runtime.getStatus(),
      bridge().auth.getStatus(),
    ]);
    set({ runtime, auth });
  },

  async startLogin() {
    set({ busy: true });
    try {
      const auth = await bridge().auth.startLogin();
      set({ auth, notice: auth.detail ?? null });
    } catch (error) {
      set({ notice: errorMessage(error) });
    } finally {
      set({ busy: false });
    }
  },

  async chooseFolder(confirmedPath) {
    set({ busy: true, pendingConfirmation: null });
    try {
      const result = await bridge().workspace.choose(
        confirmedPath ? { confirmedPath } : {},
      );
      if (result.status === 'cancelled') return;
      if (result.status === 'blocked') {
        set({ notice: `이 폴더는 열 수 없습니다: ${result.candidate.reasons.join(' ')}` });
        return;
      }
      if (result.status === 'needs-confirmation') {
        set({ pendingConfirmation: result.candidate });
        return;
      }
      await activateWorkspace(set, get, result.workspace);
    } catch (error) {
      set({ notice: errorMessage(error) });
    } finally {
      set({ busy: false });
    }
  },

  async openRecent(workspaceId) {
    set({ busy: true });
    try {
      const result = await bridge().workspace.openRecent({ workspaceId });
      if (result.status === 'opened') await activateWorkspace(set, get, result.workspace);
      else if (result.status === 'needs-confirmation') {
        set({ pendingConfirmation: result.candidate });
      } else if (result.status === 'blocked') {
        set({ notice: `이 폴더는 열 수 없습니다: ${result.candidate.reasons.join(' ')}`, noticeKind: 'error' });
      }
    } catch (error) {
      set({ notice: errorMessage(error) });
    } finally {
      set({ busy: false });
    }
  },

  async newSession(isolation) {
    const workspace = get().workspace;
    if (!workspace) return;
    let chosen: IsolationPref = isolation ?? get().lastIsolation;
    if (get().draft.trim()) {
      const ok = await get().askConfirm('새 대화', '작성 중인 내용이 있습니다. 새 대화를 시작할까요?');
      if (!ok) return;
    }
    if (!(await abandonFilePreview(get))) return;
    if (chosen === 'none') {
      const sharing = get().sessions.some(
        (entry) =>
          entry.live &&
          !entry.worktreePath &&
          (entry.status === 'running' || entry.status === 'waiting-approval' || entry.status === 'starting'),
      );
      if (sharing) {
        const isolate = await get().askConfirm(
          '같은 폴더에서 병렬',
          '이미 이 폴더에서 작업 중인 대화가 있습니다. 확인하면 워크트리로 격리하고, 취소하면 같은 폴더를 같이 씁니다.',
        );
        if (isolate) chosen = 'worktree';
      }
    }
    stashDraft(get, set);
    set({ busy: true, queue: [], activeDiff: null, attachments: [], tools: [], draft: '', filePreview: null, sideAskOpen: false });
    try {
      const opened = await bridge().session.create({
        workspaceId: workspace.id,
        mode: get().mode,
        isolation: chosen,
      });
      applyOpened(set, get, opened, { notice: null });
      saveIsolation(chosen);
      set({
        lastIsolation: chosen,
        sessions: await bridge().session.list({ workspaceId: workspace.id }),
      });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    } finally {
      set({ busy: false });
    }
  },

  async openSession(sessionId) {
    const current = get().session;
    if (current?.id === sessionId && get().status !== 'failed') return;
    if (!(await abandonFilePreview(get))) return;
    if (get().splitSession?.id === sessionId) get().closeSplitSession();
    stashDraft(get, set);
    const previousDraft = get().draft;
    set({ busy: true, queue: [], activeDiff: null, attachments: [], tools: [], draft: get().drafts[sessionId] ?? '', filePreview: null, sideAskOpen: false });
    try {
      const opened = await bridge().session.resume({ sessionId });
      applyOpened(set, get, opened);
      const workspace = get().workspace;
      if (workspace) set({ sessions: await bridge().session.list({ workspaceId: workspace.id }) });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error', draft: previousDraft });
    } finally {
      set({ busy: false });
    }
  },

  async deleteSession(sessionId) {
    const current = get().session;
    const ok = await get().askConfirm('대화 삭제', '이 대화를 삭제할까요? 화면 기록은 되돌릴 수 없습니다.');
    if (!ok) return;
    if (get().splitSession?.id === sessionId) get().closeSplitSession();
    const deletingCurrent = current?.id === sessionId;
    if (deletingCurrent) {
      set({
        session: null,
        items: [],
        queue: [],
        changes: [],
        activeDiff: null,
        attachments: [],
        draft: '',
        status: 'closed',
        sessions: get().sessions.filter((entry) => entry.id !== sessionId),
      });
    }
    set({ busy: true });
    try {
      await bridge().session.delete({ sessionId });
      if (get().pinnedIds.includes(sessionId)) {
        const pinnedIds = get().pinnedIds.filter((id) => id !== sessionId);
        savePinnedIds(pinnedIds);
        set({ pinnedIds });
      }
      if (deletingCurrent) {
        await get().newSession('none');
      } else {
        const workspace = get().workspace;
        if (workspace) set({ sessions: await bridge().session.list({ workspaceId: workspace.id }) });
      }
    } catch (error) {
      set({ notice: errorMessage(error) });
    } finally {
      set({ busy: false });
    }
  },

  async renameSession(sessionId, title) {
    try {
      const updated = await bridge().session.rename({ sessionId, title });
      set((state) => ({
        session: state.session?.id === sessionId ? { ...state.session, title: updated.title } : state.session,
        splitSession:
          state.splitSession?.id === sessionId ? { ...state.splitSession, title: updated.title } : state.splitSession,
        sessions: state.sessions.map((entry) => (entry.id === sessionId ? { ...entry, title: updated.title } : entry)),
      }));
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  async restartSession() {
    const session = get().session;
    if (!session) return;
    set({ busy: true, queue: [] });
    try {
      const opened = await bridge().session.restart({ sessionId: session.id });
      applyOpened(set, get, opened, { notice: '세션을 다시 연결했습니다.' });
    } catch (error) {
      set({ notice: errorMessage(error), status: 'failed' });
    } finally {
      set({ busy: false });
    }
  },

  async setModel(modelId) {
    const session = get().session;
    if (!session || get().currentModelId === modelId) return;
    set({ busy: true, notice: '모델을 바꾸는 중입니다. 대화는 그대로 유지됩니다.' });
    try {
      const opened = await bridge().session.setModel({ sessionId: session.id, model: modelId });
      applyOpened(set, get, opened, { notice: null });
      set({ currentModelId: modelId });
    } catch (error) {
      set({ notice: errorMessage(error) });
    } finally {
      set({ busy: false });
    }
  },

  setMode(mode) {
    const session = get().session;
    set((state) => ({
      mode,
      session: state.session ? { ...state.session, mode } : null,
      sessions: state.sessions.map((entry) =>
        entry.id === state.session?.id ? { ...entry, mode } : entry,
      ),
    }));
    if (session) {
      void bridge()
        .session.setMode({ sessionId: session.id, mode })
        .catch((error: unknown) => set({ notice: errorMessage(error), noticeKind: 'error' }));
    }
  },

  async send(text, attachments, tools = [], opts = {}) {
    const session = get().session;
    if (!session) return false;
    if (get().status === 'running' || get().status === 'waiting-approval') {
      get().enqueue(text, attachments, tools, opts);
      return true;
    }
    filesChangedThisTurn = false;
    const optimisticId = nextId();
    const visible = opts.sideAsk ? `옆 질문: ${text}` : text;
    set((state) => ({
      items: [
        ...state.items,
        {
          kind: 'user',
          id: optimisticId,
          text: visible,
          at: new Date().toISOString(),
          attachments: attachments.length > 0 ? attachments : undefined,
        },
      ],
      status: 'running',
      attachments: [],
      tools: [],
    }));
    try {
      await bridge().session.prompt({
        sessionId: session.id,
        text,
        attachments,
        tools,
        mode: get().mode,
        clientItemId: optimisticId,
        sideAsk: opts.sideAsk,
      });
      return true;
    } catch (error) {
      set((state) => ({
        notice: errorMessage(error),
        noticeKind: 'error',
        status: state.session?.id === session.id ? 'idle' : state.status,
        items:
          state.session?.id === session.id
            ? state.items.filter((item) => item.id !== optimisticId)
            : state.items,
      }));
      return false;
    }
  },

  enqueue(text, attachments, tools = [], opts = {}) {
    set((state) => ({
      queue: [...state.queue, { id: nextId(), text, attachments, tools, sideAsk: opts.sideAsk }],
    }));
  },

  removeQueued(id) {
    set((state) => ({ queue: state.queue.filter((item) => item.id !== id) }));
  },

  restoreQueued(id) {
    const item = get().queue.find((entry) => entry.id === id);
    if (!item) return;
    const currentDraft = get().draft.trim();
    set((state) => ({
      queue: [
        ...state.queue.filter((entry) => entry.id !== id),
        ...(currentDraft
          ? [{ id: nextId(), text: state.draft, attachments: state.attachments, tools: state.tools }]
          : []),
      ],
      draft: item.text,
      attachments: item.attachments,
      tools: item.tools,
    }));
    queueMicrotask(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus());
  },

  togglePin(sessionId) {
    const pinnedIds = toggleId(get().pinnedIds, sessionId);
    savePinnedIds(pinnedIds);
    set({ pinnedIds });
  },

  setLastIsolation(value) {
    saveIsolation(value);
    set({ lastIsolation: value });
  },

  promoteQueued(id) {
    set((state) => {
      const item = state.queue.find((entry) => entry.id === id);
      if (!item) return state;
      return { queue: [item, ...state.queue.filter((entry) => entry.id !== id)] };
    });
  },

  sendQueuedNow(id) {
    const item = get().queue.find((entry) => entry.id === id);
    if (!item) return;
    set((state) => ({ queue: [item, ...state.queue.filter((entry) => entry.id !== id)] }));
    if (get().status === 'idle') get().flushQueue();
  },

  openMediaLightbox(media) {
    if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(media.src)) return;
    set({ mediaLightbox: media });
  },

  closeMediaLightbox() {
    set({ mediaLightbox: null });
  },

  async stageAll() {
    const session = get().session;
    const files = get().changes.filter((change) => change.status !== 'deleted');
    if (!session || files.length === 0) return;
    const ok = await get().askConfirm('모두 스테이징', `${files.length}개 파일을 스테이징할까요?`);
    if (!ok) return;
    try {
      for (const file of files) {
        await bridge().changes.act({ sessionId: session.id, relPath: file.relPath, action: 'stage' });
      }
      get().notify(`${files.length}개 파일을 스테이징했습니다.`);
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    } finally {
      await get().listReviewFiles();
    }
  },

  async revertAll() {
    const session = get().session;
    const files = get().changes.filter((change) => change.revertable);
    if (!session || files.length === 0) return;
    const ok = await get().askConfirm(
      '모두 되돌리기',
      `${files.length}개 파일의 변경을 되돌릴까요? 이 동작은 되돌리기 어렵습니다.`,
    );
    if (!ok) return;
    try {
      for (const file of files) {
        await bridge().changes.revert({ sessionId: session.id, relPath: file.relPath, scope: get().reviewScope });
      }
      get().notify(`${files.length}개 파일의 변경을 되돌렸습니다.`);
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    } finally {
      await get().listReviewFiles();
    }
  },

  flushQueue() {
    const { queue, session, status } = get();
    const next = queue[0];
    if (!session || !next || status !== 'idle') return;
    set({ queue: queue.slice(1) });
    void get().send(next.text, next.attachments, next.tools, { sideAsk: next.sideAsk });
  },

  addAttachments(relPaths) {
    const cleaned = relPaths.filter(
      (relPath) =>
        Boolean(relPath) &&
        !relPath.startsWith('/') &&
        !relPath.startsWith('~') &&
        !relPath.split(/[/\\]/).includes('..'),
    );
    if (cleaned.length === 0) return;
    set((state) => ({
      attachments: [...new Set([...state.attachments, ...cleaned])].slice(0, 20),
    }));
  },

  removeAttachment(relPath) {
    set((state) => ({ attachments: state.attachments.filter((entry) => entry !== relPath) }));
  },

  toggleTool(tool) {
    set((state) => ({
      tools: state.tools.includes(tool) ? state.tools.filter((entry) => entry !== tool) : [...state.tools, tool],
    }));
  },

  async pickAttachments() {
    const workspace = get().workspace;
    if (!workspace) return;
    try {
      const paths = await bridge().workspace.pickFiles({ workspaceId: workspace.id });
      get().addAttachments(paths);
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  async pasteImages(files) {
    const workspace = get().workspace;
    if (!workspace) {
      set({ notice: '폴더를 연 뒤에 이미지를 붙여 넣으세요.', noticeKind: 'error' });
      return;
    }
    if (files.length === 0) return;
    const allowed = files.filter((file) =>
      file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp' || file.type === 'image/gif',
    );
    if (allowed.length === 0) {
      set({ notice: '붙여넣을 수 있는 이미지가 아닙니다.', noticeKind: 'error' });
      return;
    }
    try {
      const paths: string[] = [];
      for (const file of allowed.slice(0, 8)) {
        const buffer = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (const byte of buffer) binary += String.fromCharCode(byte);
        const data = btoa(binary);
        const relPath = await bridge().workspace.saveInboxImage({
          workspaceId: workspace.id,
          mime: file.type as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
          data,
        });
        paths.push(relPath);
      }
      get().addAttachments(paths);
      get().notify(`이미지 ${paths.length}개를 첨부했습니다.`);
      queueTreeRefresh(['', 'desktop-inbox']);
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async dropFiles(files) {
    const workspace = get().workspace;
    if (!workspace || files.length === 0) return;
    try {
      const paths = await bridge().workspace.attachDropped(workspace.id, files);
      if (paths.length === 0) {
        set({ notice: '작업공간 안의 파일만 첨부할 수 있습니다.' });
        return;
      }
      get().addAttachments(paths);
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  attachFromTree(relPath) {
    get().addAttachments([relPath]);
  },

  async updateWorkspace(patch) {
    const workspace = get().workspace;
    if (!workspace) return;
    try {
      const updated = await bridge().workspace.update({ workspaceId: workspace.id, ...patch });
      set({ workspace: updated });
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  async exportConversation() {
    const session = get().session;
    if (!session) return null;
    try {
      const exported = await bridge().session.exportTranscript({ sessionId: session.id });
      await navigator.clipboard.writeText(exported.markdown);
      set({ notice: '대화를 클립보드에 복사했습니다.' });
      return exported.markdown;
    } catch (error) {
      set({ notice: errorMessage(error) });
      return null;
    }
  },

  async copyLastAnswer() {
    const last = [...get().items].reverse().find((item) => item.kind === 'message' && item.channel === 'answer');
    if (!last || last.kind !== 'message') {
      get().notify('복사할 답변이 없습니다.', 'warn');
      return;
    }
    try {
      await navigator.clipboard.writeText(last.text);
      get().notify('마지막 답변을 복사했습니다.');
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async regenerate() {
    const items = get().items;
    const lastUser = [...items].reverse().find((item) => item.kind === 'user');
    if (!lastUser || lastUser.kind !== 'user') return;
    const session = get().session;
    if (!session) return;
    const ok = await get().askConfirm(
      '다시 생성',
      '마지막 답변을 지우고 같은 질문으로 다시 생성합니다. 에이전트 대화도 함께 되돌립니다.',
    );
    if (!ok) return;
    try {
      const rewound = await bridge().session.rewind({
        sessionId: session.id,
        userItemId: lastUser.id,
        keepUser: false,
      });
      set({ items: rewound, tools: [] });
      const sent = await get().send(lastUser.text, lastUser.attachments ?? []);
      if (!sent) {
        set((state) => ({
          items: state.items.some((item) => item.id === lastUser.id) ? state.items : [...state.items, lastUser],
          draft: state.draft || lastUser.text,
        }));
      }
    } catch (error) {
      set((state) => ({
        notice: errorMessage(error),
        noticeKind: 'error',
        status: 'idle',
        draft: state.draft || lastUser.text,
      }));
    }
  },

  setDraft(text) {
    set({ draft: text });
  },

  askConfirm(title, message) {
    return new Promise<boolean>((resolve) => {
      confirmResolver?.(false);
      confirmResolver = resolve;
      set({ confirm: { title, message } });
    });
  },

  answerConfirm(ok) {
    confirmResolver?.(ok);
    confirmResolver = null;
    set({ confirm: null });
  },

  async previewFile(relPath, line) {
    const workspace = get().workspace;
    if (!workspace) return;
    const current = get().filePreview;
    if (current?.relPath === relPath) {
      if (line !== undefined || current.text !== current.originalText) {
        set({
          filePreview: { ...current, line: line ?? current.line },
          activeDiff: null,
          reviewOpen: false,
          localhostPreview: null,
        });
        return;
      }
    } else if (current && !(await abandonFilePreview(get))) {
      return;
    }
    try {
      const file = await bridge().workspace.readFile({ workspaceId: workspace.id, relPath });
      const recentFiles = rememberPath(get().recentFiles, file.relPath);
      set({
        filePreview: {
          relPath: file.relPath,
          text: file.text,
          truncated: file.truncated,
          masked: file.masked,
          line,
          originalText: file.text,
        },
        activeDiff: null,
        reviewOpen: false,
        localhostPreview: null,
        recentFiles,
      });
      saveRecentFiles(workspace.id, recentFiles);
      void get().revealInTree(file.relPath);
    } catch (error) {
      const recentFiles = get().recentFiles.filter((entry) => entry !== relPath);
      if (recentFiles.length !== get().recentFiles.length) {
        set({ recentFiles });
        saveRecentFiles(workspace.id, recentFiles);
      }
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async copyPath(relPath) {
    try {
      await navigator.clipboard.writeText(relPath);
      get().notify(`${relPath} 경로를 복사했습니다.`);
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  setFileSwitcherOpen(open, mode = 'files') {
    set({
      fileSwitcherOpen: open,
      fileSwitcherMode: open ? mode : get().fileSwitcherMode,
      settingsOpen: open ? false : get().settingsOpen,
      shortcutsOpen: open ? false : get().shortcutsOpen,
    });
  },

  setSidebarTab(tab) {
    set({ sidebarTab: tab });
  },

  openFileSearch() {
    set({
      sidebarTab: 'files',
      fileSearchFocus: get().fileSearchFocus + 1,
      fileSwitcherOpen: false,
    });
  },

  async closeFilePreview() {
    if (!(await abandonFilePreview(get))) return;
    set({ filePreview: null });
  },

  setFollowOutput(follow) {
    set({ followOutput: follow });
  },

  setSettingsOpen(open) {
    set({
      settingsOpen: open,
      shortcutsOpen: open ? false : get().shortcutsOpen,
      fileSwitcherOpen: open ? false : get().fileSwitcherOpen,
    });
  },

  setShortcutsOpen(open) {
    set({
      shortcutsOpen: open,
      settingsOpen: open ? false : get().settingsOpen,
      fileSwitcherOpen: open ? false : get().fileSwitcherOpen,
    });
  },

  notify(message, kind = 'info') {
    if (noticeTimer) clearTimeout(noticeTimer);
    set({ notice: message, noticeKind: kind });
    noticeTimer = setTimeout(() => {
      if (get().notice === message) set({ notice: null });
    }, 4_000);
  },

  async cancel() {
    const session = get().session;
    if (!session) return;
    // Stopping means stopping: queued follow-ups would be a surprise.
    set({ queue: [] });
    await bridge().session.cancel({ sessionId: session.id }).catch(() => undefined);
  },

  async decide(requestId, scope) {
    const session = get().session;
    if (!session || get().status !== 'waiting-approval' || decideInFlight) return;
    decideInFlight = true;
    try {
      await bridge().session.decidePermission({
        sessionId: session.id,
        requestId,
        optionId: scope,
        scope,
      });
      set({ followOutput: true });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    } finally {
      decideInFlight = false;
    }
  },

  async toggleDirectory(relPath) {
    const { expanded, tree, workspace } = get();
    if (!workspace) return;
    if (expanded.includes(relPath)) {
      set({ expanded: expanded.filter((entry) => entry !== relPath) });
      return;
    }
    if (!tree[relPath]) {
      try {
        const nodes = await bridge().workspace.readTree({ workspaceId: workspace.id, relPath });
        set((state) => ({ tree: { ...state.tree, [relPath]: nodes } }));
      } catch (error) {
        set({ notice: errorMessage(error) });
        return;
      }
    }
    set((state) => ({ expanded: [...state.expanded, relPath] }));
  },

  async showDiff(relPath, scope = get().reviewScope) {
    const session = get().session;
    if (!session) return;
    if (!(await abandonFilePreview(get))) return;
    try {
      const result = await bridge().changes.diff({
        sessionId: session.id,
        relPath,
        view: 'unified',
        scope,
      });
      set({ activeDiff: result, reviewOpen: true, reviewScope: scope, filePreview: null, localhostPreview: null });
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  closeDiff() {
    set({ activeDiff: null, reviewOpen: false });
  },

  async revert(relPath) {
    const session = get().session;
    if (!session) return;
    try {
      await bridge().changes.revert({ sessionId: session.id, relPath, scope: get().reviewScope });
      await get().listReviewFiles();
      set({ notice: `${relPath} 변경을 되돌렸습니다.` });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async setReviewOpen(open) {
    if (open && !(await abandonFilePreview(get))) return;
    set({
      reviewOpen: open,
      filePreview: open ? null : get().filePreview,
      localhostPreview: open ? null : get().localhostPreview,
      activeDiff: open ? get().activeDiff : null,
    });
  },

  async setReviewScope(scope) {
    set({ reviewScope: scope });
    try {
      await get().listReviewFiles();
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  addReviewComment(relPath, line, text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((state) => ({
      reviewComments: [...state.reviewComments, { relPath, line, text: trimmed }],
    }));
  },

  async submitReview() {
    const session = get().session;
    const comments = get().reviewComments;
    if (!session || comments.length === 0) return;
    const body = [
      '다음 리뷰 댓글을 반영하라. 범위는 최소로 유지하라.',
      ...comments.map((comment) => `- ${comment.relPath} (${comment.line}): ${comment.text}`),
    ].join('\n');
    set({ reviewComments: [] });
    await get().send(body, []);
  },

  async continuePlan() {
    const busy = get().status === 'running' || get().status === 'waiting-approval';
    if (busy) {
      get().enqueue('이 계획으로 진행하라.', []);
      get().notify('계획 진행을 대기열에 넣었습니다.');
      return;
    }
    await get().send('이 계획으로 진행하라.', []);
  },

  async listReviewFiles() {
    const session = get().session;
    if (!session) return [];
    const files = await bridge().changes.list({ sessionId: session.id, scope: get().reviewScope });
    const current = get().activeDiff?.relPath;
    set({ changes: files });
    if (current && files.some((file) => file.relPath === current)) {
      await get().showDiff(current, get().reviewScope);
    } else if (current) {
      set({ activeDiff: null });
    }
    return files;
  },

  async openExternal(url) {
    try {
      await bridge().external.openSafeUrl({ url });
    } catch (error) {
      set({ notice: errorMessage(error) });
    }
  },

  dismissNotice() {
    set({ notice: null });
  },

  setViewMode(mode) {
    saveViewMode(mode);
    set({ viewMode: mode });
  },

  async copyFilePreview() {
    const preview = get().filePreview;
    if (!preview) return;
    if (preview.masked) {
      get().notify('가려진 비밀 값은 복사하지 않습니다.', 'warn');
      return;
    }
    try {
      await navigator.clipboard.writeText(preview.text);
      get().notify(preview.truncated ? '보이는 일부만 복사했습니다.' : '파일 내용을 복사했습니다.');
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async previewRecent(delta) {
    const current = get().filePreview?.relPath;
    const list = get().recentFiles;
    if (list.length === 0) return;
    const index = current ? list.indexOf(current) : 0;
    const next = list[(index < 0 ? 0 : index) + delta];
    if (next) await get().previewFile(next);
  },

  async revealInTree(relPath, opts = {}) {
    const workspace = get().workspace;
    if (!workspace || !relPath) return;
    const request = (revealTreeSeq += 1);
    const dirs = ancestorDirs(relPath);
    if (opts.directory && relPath) dirs.push(relPath);
    const tree = { ...get().tree };
    const expanded = new Set(get().expanded);
    try {
      for (const dir of dirs) {
        if (!tree[dir]) {
          tree[dir] = await bridge().workspace.readTree({ workspaceId: workspace.id, relPath: dir });
        }
        expanded.add(dir);
      }
    } catch (error) {
      if (opts.show) set({ notice: errorMessage(error), noticeKind: 'error' });
      return;
    }
    const stale = request !== revealTreeSeq;
    set({
      tree: { ...get().tree, ...tree },
      expanded: [...new Set([...get().expanded, ...expanded])],
      revealedFile: stale ? get().revealedFile : relPath,
      sidebarTab: opts.show && !stale ? 'files' : get().sidebarTab,
    });
  },

  async saveFilePreview() {
    const workspace = get().workspace;
    const preview = get().filePreview;
    if (!workspace || !preview) return;
    if (preview.truncated) {
      set({ notice: '파일이 일부만 열려 있어 저장하지 않습니다. 잘린 내용으로 덮어쓰지 않습니다.', noticeKind: 'error' });
      return;
    }
    if (preview.masked) {
      set({ notice: '비밀 값이 가려진 미리보기는 저장하지 않습니다. 원본을 덮어쓰지 않습니다.', noticeKind: 'error' });
      return;
    }
    try {
      await bridge().workspace.writeFile({
        workspaceId: workspace.id,
        relPath: preview.relPath,
        content: preview.text,
      });
      get().notify(`${preview.relPath}을 저장했습니다.`);
      set({ filePreview: { ...preview, originalText: preview.text } });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async revealPath(relPath) {
    const workspace = get().workspace;
    if (!workspace) return;
    try {
      await bridge().workspace.reveal({ workspaceId: workspace.id, relPath });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async openPath(relPath) {
    const workspace = get().workspace;
    if (!workspace) return;
    try {
      await bridge().workspace.openPath({ workspaceId: workspace.id, relPath });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async rewindTo(userItemId) {
    const session = get().session;
    if (!session) return;
    const ok = await get().askConfirm('대화 되돌리기', '이 메시지 이후의 대화를 자를까요? 파일은 그대로입니다.');
    if (!ok) return;
    try {
      const items = await bridge().session.rewind({ sessionId: session.id, userItemId, keepUser: true });
      set({ items, notice: '대화를 되돌렸습니다.' });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async editUserMessage(userItemId) {
    const session = get().session;
    const item = get().items.find((entry) => entry.id === userItemId);
    if (!session || !item || item.kind !== 'user') return;
    const ok = await get().askConfirm('메시지 수정', '이 메시지부터 다시 작성합니다. 이후 대화는 잘립니다.');
    if (!ok) return;
    try {
      const items = await bridge().session.rewind({ sessionId: session.id, userItemId, keepUser: false });
      set({ items, draft: item.text, notice: '메시지를 입력창에 넣었습니다. 고친 뒤 보내면 됩니다.' });
      queueMicrotask(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus());
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async forkSession() {
    const session = get().session;
    if (!session) return;
    set({ busy: true });
    try {
      const opened = await bridge().session.fork({ sessionId: session.id });
      applyOpened(set, get, opened, { notice: '대화를 분기했습니다.' });
      const workspace = get().workspace;
      if (workspace) set({ sessions: await bridge().session.list({ workspaceId: workspace.id }) });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    } finally {
      set({ busy: false });
    }
  },

  async applyWorktree() {
    const session = get().session;
    if (!session?.worktreePath) return;
    const ok = await get().askConfirm('워크트리 적용', '이 워크트리의 변경을 원래 폴더에 적용할까요?');
    if (!ok) return;
    try {
      await bridge().session.applyWorktree({ sessionId: session.id });
      set({ notice: '워크트리 변경을 적용했습니다.' });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async exportRaw() {
    const session = get().session;
    if (!session) return;
    try {
      const raw = await bridge().session.exportRaw({ sessionId: session.id });
      await navigator.clipboard.writeText(raw);
      set({ notice: 'jsonl을 클립보드에 복사했습니다.' });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async loadExtras() {
    const workspace = get().workspace;
    if (!workspace) return { mcp: [], skills: [] };
    return bridge().workspace.extras({ workspaceId: workspace.id });
  },

  async toggleExtra(kind, name, enabled) {
    const workspace = get().workspace;
    if (!workspace) return { mcp: [], skills: [] };
    try {
      const extras = await bridge().workspace.toggleExtra({
        workspaceId: workspace.id,
        kind,
        name,
        enabled,
      });
      const restart =
        get().session &&
        (await get().askConfirm(
          '연결 다시 시작',
          `${name}을 ${enabled ? '켰' : '껐'}습니다. 지금 연결을 다시 시작해야 적용됩니다. 다시 시작할까요?`,
        ));
      if (restart) await get().restartSession();
      else set({ notice: `${name}을 ${enabled ? '켰' : '껐'}습니다. 연결을 다시 시작해야 적용됩니다.` });
      return extras;
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
      return get().loadExtras();
    }
  },

  async commitChanges(message) {
    const session = get().session;
    if (!session) return;
    const ok = await get().askConfirm('커밋', '스테이징된 변경을 이 메시지로 커밋할까요? 훅이 실행될 수 있습니다.');
    if (!ok) return;
    try {
      await bridge().changes.commit({ sessionId: session.id, message });
      set({ notice: '커밋했습니다.' });
      await get().listReviewFiles();
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async exportLog() {
    try {
      const log = await bridge().runtime.exportLog();
      await navigator.clipboard.writeText(log);
      set({ notice: '진단 로그를 클립보드에 복사했습니다.' });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async loadSessionInfo() {
    const session = get().session;
    if (!session) return;
    const sessionId = session.id;
    try {
      const info = await bridge().session.info({ sessionId });
      if (get().session?.id !== sessionId) return;
      set({ sessionInfo: info, gitBranch: info.branch ?? null });
    } catch {
      if (get().session?.id !== sessionId) return;
    }
  },

  async pushChanges() {
    const session = get().session;
    if (!session) return;
    const ok = await get().askConfirm('푸시', '현재 브랜치를 origin에 올릴까요? 강제 푸시는 하지 않습니다.');
    if (!ok) return;
    try {
      const message = await bridge().changes.push({ sessionId: session.id });
      set({ notice: message });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  async createPullRequest(title, body) {
    const session = get().session;
    if (!session) return;
    const ok = await get().askConfirm('Pull Request', 'GitHub CLI로 PR을 만들까요?');
    if (!ok) return;
    try {
      const url = await bridge().changes.createPr({ sessionId: session.id, title, body });
      set({ notice: url });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  openLocalhostPreview(url) {
    void (async () => {
      if (!(await abandonFilePreview(get))) return;
      set({ localhostPreview: url, reviewOpen: false, filePreview: null });
    })();
  },

  closeLocalhostPreview() {
    set({ localhostPreview: null });
  },

  async openSplitSession(sessionId) {
    const current = get().session;
    if (!current || current.id === sessionId) return;
    try {
      const opened = await bridge().session.resume({ sessionId });
      set({
        splitSession: opened.session,
        splitItems: opened.items,
        splitStatus: opened.session.status,
      });
    } catch (error) {
      set({ notice: errorMessage(error), noticeKind: 'error' });
    }
  },

  closeSplitSession() {
    set({ splitSession: null, splitItems: [], splitStatus: 'idle' });
  },

  setSideAskOpen(open) {
    if (open && !get().session) return;
    set({ sideAskOpen: open });
  },

  sideAsk(text) {
    const trimmed = text.trim();
    if (!trimmed || !get().session) return;
    set({ sideAskOpen: false });
    const busy = get().status === 'running' || get().status === 'waiting-approval';
    if (busy) {
      get().enqueue(trimmed, [], [], { sideAsk: true });
      get().notify('옆 질문을 대기열에 넣었습니다. 지금 하던 작업이 끝나면 물어봅니다.');
      return;
    }
    void get().send(trimmed, [], [], { sideAsk: true });
  },

  async focusSplitSession() {
    const split = get().splitSession;
    const primary = get().session;
    if (!split || !primary) return;
    const parked = { session: primary, items: get().items, status: get().status };
    await get().openSession(split.id);
    if (get().session?.id === split.id) {
      set({ splitSession: parked.session, splitItems: parked.items, splitStatus: parked.status });
    }
  },

  ingest(event) {
    if (event.type === 'focus-session') {
      void get().openSession(event.sessionId);
      return;
    }
    const currentId = get().session?.id;
    const splitId = get().splitSession?.id;
    if ('sessionId' in event && event.sessionId && splitId && event.sessionId === splitId && event.sessionId !== currentId) {
      if (event.type === 'session-status') {
        set((state) => ({
          splitStatus: event.status,
          sessions: state.sessions.map((entry) =>
            entry.id === event.sessionId ? { ...entry, status: event.status } : entry,
          ),
        }));
        if (event.status === 'waiting-approval') {
          get().notify('옆에 연 대화가 승인을 기다립니다. 「앞으로」로 승인하세요.', 'warn');
          set((state) => ({ attentionIds: attentionOf(state.attentionIds, event.sessionId) }));
        }
        return;
      }
      if (event.type === 'transcript-replaced') {
        set({ splitItems: event.items });
        return;
      }
      set((state) => ({ splitItems: applyTranscriptEvent(state.splitItems, event) }));
      return;
    }
    if ('sessionId' in event && event.sessionId && currentId && event.sessionId !== currentId) {
      if (event.type === 'file-changed') {
        const other = get().sessions.find((entry) => entry.id === event.sessionId);
        if (other && !other.worktreePath && !get().session?.worktreePath) {
          queueTreeRefresh(['', parentDir(event.change.relPath)]);
        }
      }
      if (event.type === 'session-status') {
        set((state) => ({
          sessions: state.sessions.map((entry) =>
            entry.id === event.sessionId ? { ...entry, status: event.status } : entry,
          ),
        }));
        if (event.status === 'waiting-approval') {
          get().notify('다른 대화가 승인을 기다립니다.', 'warn');
          set((state) => ({ attentionIds: attentionOf(state.attentionIds, event.sessionId) }));
        }
        if (event.status === 'failed') {
          get().notify('다른 대화가 오류로 멈췄습니다.', 'error');
          set((state) => ({ attentionIds: attentionOf(state.attentionIds, event.sessionId) }));
        }
      }
      if (event.type === 'turn-ended' && event.stopReason !== 'error' && event.stopReason !== 'cancelled') {
        get().notify('다른 대화가 한 턴을 마쳤습니다.');
        set((state) => ({ attentionIds: attentionOf(state.attentionIds, event.sessionId) }));
      }
      return;
    }
    switch (event.type) {
      case 'runtime-status':
        set({ runtime: event.status });
        return;
      case 'models':
        set((state) => ({
          models: event.models,
          currentModelId: event.currentModelId ?? state.currentModelId,
        }));
        return;
      case 'usage':
        set((state) => ({
          usage: event.usage,
          currentModelId: event.usage.modelId ?? state.currentModelId,
        }));
        return;
      case 'session-status':
        set((state) => ({
          status: event.status,
          session:
            state.session && event.sessionId === state.session.id
              ? { ...state.session, status: event.status }
              : state.session,
          sessions: state.sessions.map((entry) =>
            entry.id === event.sessionId ? { ...entry, status: event.status } : entry,
          ),
        }));
        if (event.status === 'idle') queueMicrotask(() => get().flushQueue());
        return;
      case 'session-updated':
        set((state) => ({
          session: state.session?.id === event.session.id ? { ...state.session, ...event.session } : state.session,
          splitSession:
            state.splitSession?.id === event.session.id
              ? { ...state.splitSession, ...event.session }
              : state.splitSession,
          sessions: state.sessions.some((entry) => entry.id === event.session.id)
            ? state.sessions.map((entry) => (entry.id === event.session.id ? event.session : entry))
            : [event.session, ...state.sessions],
        }));
        return;
      case 'message-end':
        return;
      case 'plan': {
        const firstPlan = !get().items.some((item) => item.kind === 'plan');
        set((state) => ({
          items: applyTranscriptEvent(state.items, event),
          sidebarTab: firstPlan ? 'tasks' : state.sidebarTab,
        }));
        return;
      }
      case 'file-changed': {
        const parent = parentDir(event.change.relPath);
        filesChangedThisTurn = true;
        set((state) => ({
          items: applyTranscriptEvent(state.items, event),
          changes: [
            ...state.changes.filter((change) => change.relPath !== event.change.relPath),
            event.change,
          ].sort((a, b) => a.relPath.localeCompare(b.relPath)),
        }));
        queueTreeRefresh(['', parent]);
        return;
      }
      case 'turn-ended': {
        const shouldReview = filesChangedThisTurn;
        filesChangedThisTurn = false;
        set({ status: 'idle' });
        void get().loadSessionInfo();
        const preview = get().filePreview;
        const dirty = Boolean(preview && preview.text !== preview.originalText);
        if (shouldReview && !get().reviewOpen && !dirty) {
          void get().setReviewOpen(true);
        }
        return;
      }
      default:
        set((state) => ({ items: applyTranscriptEvent(state.items, event) }));
    }
  },
}));

function applyOpened(
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
  opened: SessionOpenResult,
  extra: Partial<State> = {},
): void {
  const notice =
    extra.notice !== undefined
      ? extra.notice
      : opened.agentContext === 'fresh' && opened.items.length > 0
        ? '이전 대화를 화면에 복원했습니다. 에이전트는 새 컨텍스트로 시작합니다.'
        : extra.notice ?? null;
  const workspaceChanged = opened.session.workspace.id !== get().workspace?.id;
  filesChangedThisTurn = false;
  decideInFlight = false;
  set({
    workspace: opened.session.workspace,
    session: opened.session,
    items: opened.items,
    changes: opened.changes,
    status: opened.session.status,
    mode: opened.session.mode,
    followOutput: true,
    sideAskOpen: false,
    attentionIds: get().attentionIds.filter((id) => id !== opened.session.id),
    fileSwitcherOpen: false,
    mediaLightbox: null,
    recentFiles: loadRecentFiles(opened.session.workspace.id),
    tree: workspaceChanged ? {} : get().tree,
    expanded: workspaceChanged ? [] : get().expanded,
    ...extra,
    notice,
  });
  if (workspaceChanged) {
    const workspaceId = opened.session.workspace.id;
    void Promise.all([
      bridge().workspace.readTree({ workspaceId, relPath: '' }),
      bridge().session.list({ workspaceId }),
      bridge().workspace.listRecent(),
    ])
      .then(([nodes, sessions, recents]) => {
        if (useStore.getState().workspace?.id !== workspaceId) return;
        set({ tree: { '': nodes }, sessions, recents });
      })
      .catch((error: unknown) => set({ notice: errorMessage(error), noticeKind: 'error' }));
  }
  queueMicrotask(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus());
  void get().loadSessionInfo();
}

function attentionOf(ids: string[], sessionId: string): string[] {
  return ids.includes(sessionId) ? ids : [...ids, sessionId];
}

async function activateWorkspace(
  set: (partial: Partial<State>) => void,
  get: () => State & Actions,
  workspace: WorkspaceSummary,
): Promise<void> {
  if (get().workspace?.id === workspace.id && get().session && get().status !== 'failed') {
    return;
  }

  const listed = await bridge().session.list({ workspaceId: workspace.id });
  const preferred = workspace.lastSessionId
    ? listed.find((entry) => entry.id === workspace.lastSessionId)
    : undefined;
  const latest = preferred ?? listed.find((entry) => !entry.fromCli) ?? listed[0];
  const opened = latest
    ? await bridge().session.resume({ sessionId: latest.id })
    : await bridge().session.create({ workspaceId: workspace.id, mode: get().mode });
  set({
    workspace,
    queue: [],
    tree: {},
    expanded: [],
    activeDiff: null,
    attachments: [],
    filePreview: null,
    localhostPreview: null,
    splitSession: null,
    splitItems: [],
    splitStatus: 'idle',
  });
  applyOpened(set, get, opened);
  const nodes = await bridge().workspace.readTree({ workspaceId: workspace.id, relPath: '' });
  set({
    tree: { '': nodes },
    recents: await bridge().workspace.listRecent(),
    sessions: await bridge().session.list({ workspaceId: workspace.id }),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
