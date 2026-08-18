import type { z } from 'zod';
import type {
  AuthStatus,
  RuntimeStatus,
  SessionSummary,
  WorkMode,
  WorkspaceCandidate,
  WorkspaceSummary,
} from './domain.js';
import type { DiffPreview, FileChangeSummary, SessionEvent } from './events.js';
import type {
  cancelInput,
  chooseWorkspaceInput,
  createSessionInput,
  diffGetInput,
  listSessionsInput,
  openRecentWorkspaceInput,
  openSafeUrlInput,
  permissionDecisionInput,
  promptInput,
  readFileInput,
  readMediaInput,
  readTreeInput,
  renameSessionInput,
  searchFilesInput,
  pickFilesInput,
  attachPathsInput,
  updateWorkspaceInput,
  deleteSessionInput,
  exportSessionInput,
  setModelInput,
  restartSessionInput,
  resumeSessionInput,
  revertInput,
  diffListInput,
} from './ipc.js';
import type { AgentContext, CachedChatItem } from './transcript.js';

/** Renderer-side argument types (before zod defaults are applied). */
export type ChooseArgs = z.input<typeof chooseWorkspaceInput>;
export type OpenRecentArgs = z.input<typeof openRecentWorkspaceInput>;
export type ReadTreeArgs = z.input<typeof readTreeInput>;
export type ReadFileArgs = z.input<typeof readFileInput>;
export type SearchFilesArgs = z.input<typeof searchFilesInput>;
export type PickFilesArgs = z.input<typeof pickFilesInput>;
export type AttachPathsArgs = z.input<typeof attachPathsInput>;
export type ReadMediaArgs = z.input<typeof readMediaInput>;
export type UpdateWorkspaceArgs = z.input<typeof updateWorkspaceInput>;
export type DeleteSessionArgs = z.input<typeof deleteSessionInput>;
export type ExportSessionArgs = z.input<typeof exportSessionInput>;

export type FileHit = {
  relPath: string;
  name: string;
};

export type MediaPreview = {
  relPath: string;
  mimeType: string;
  dataUrl: string;
};

export type SessionExport = {
  title: string;
  markdown: string;
};
export type CreateSessionArgs = z.input<typeof createSessionInput>;
export type ListSessionsArgs = z.input<typeof listSessionsInput>;
export type ResumeSessionArgs = z.input<typeof resumeSessionInput>;
export type RestartSessionArgs = z.input<typeof restartSessionInput>;
export type RenameSessionArgs = z.input<typeof renameSessionInput>;
export type SetModelArgs = z.input<typeof setModelInput>;
export type PromptArgs = z.input<typeof promptInput>;
export type CancelArgs = z.input<typeof cancelInput>;
export type PermissionDecisionArgs = z.input<typeof permissionDecisionInput>;
export type DiffArgs = z.input<typeof diffGetInput>;
export type DiffListArgs = z.input<typeof diffListInput>;
export type RevertArgs = z.input<typeof revertInput>;
export type OpenSafeUrlArgs = z.input<typeof openSafeUrlInput>;

export type TreeNode = {
  name: string;
  relPath: string;
  kind: 'file' | 'directory';
  /** True for entries the app refuses to read or send to the agent (spec 8.3). */
  sensitive: boolean;
  size?: number;
  childCount?: number;
};

export type FileContent = {
  relPath: string;
  text: string;
  truncated: boolean;
  totalBytes: number;
  sensitive: boolean;
  /** True when secrets were redacted; saving this text would corrupt the file. */
  masked: boolean;
};

export type DiffResult = {
  relPath: string;
  preview: DiffPreview;
  view: 'unified' | 'split';
  revertable: boolean;
};

export type ChooseResult =
  | { status: 'cancelled' }
  | { status: 'needs-confirmation'; candidate: WorkspaceCandidate }
  | { status: 'blocked'; candidate: WorkspaceCandidate }
  | { status: 'opened'; workspace: WorkspaceSummary };

export type InstallInstructions = {
  command: string;
  docsUrl: string;
  /** The app never runs the installer itself; it only shows what to run. */
  note: string;
};

export type SessionOpenResult = {
  session: SessionSummary;
  items: CachedChatItem[];
  changes: FileChangeSummary[];
  agentContext: AgentContext;
};

/**
 * The complete surface exposed to the renderer through contextBridge (spec 5.1).
 * Nothing else crosses the boundary: no Node, no fs, no child_process, no tokens.
 */
export interface DesktopBridge {
  auth: {
    getStatus(): Promise<AuthStatus>;
    startLogin(): Promise<AuthStatus>;
  };
  runtime: {
    getStatus(): Promise<RuntimeStatus>;
    installInstructions(): Promise<InstallInstructions>;
    exportLog(): Promise<string>;
  };
  workspace: {
    choose(args?: ChooseArgs): Promise<ChooseResult>;
    listRecent(): Promise<WorkspaceSummary[]>;
    openRecent(args: OpenRecentArgs): Promise<ChooseResult>;
    readTree(args: ReadTreeArgs): Promise<TreeNode[]>;
    readFile(args: ReadFileArgs): Promise<FileContent>;
    searchFiles(args: SearchFilesArgs): Promise<FileHit[]>;
    pickFiles(args: PickFilesArgs): Promise<string[]>;
    attachPaths(args: AttachPathsArgs): Promise<string[]>;
    /** Resolves OS-dropped File objects in preload, then validates inside the workspace. */
    attachDropped(workspaceId: string, files: File[]): Promise<string[]>;
    readMedia(args: ReadMediaArgs): Promise<MediaPreview>;
    update(args: UpdateWorkspaceArgs): Promise<WorkspaceSummary>;
    writeFile(args: { workspaceId: string; relPath: string; content: string }): Promise<void>;
    saveInboxImage(args: { workspaceId: string; mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string }): Promise<string>;
    reveal(args: { workspaceId: string; relPath: string }): Promise<void>;
    openPath(args: { workspaceId: string; relPath: string }): Promise<void>;
    extras(args: { workspaceId: string }): Promise<{
      mcp: { name: string; enabled: boolean }[];
      skills: { name: string; source: string; enabled: boolean }[];
    }>;
    toggleExtra(args: {
      workspaceId: string;
      kind: 'mcp' | 'skill';
      name: string;
      enabled: boolean;
    }): Promise<{
      mcp: { name: string; enabled: boolean }[];
      skills: { name: string; source: string; enabled: boolean }[];
    }>;
  };
  session: {
    create(args: CreateSessionArgs): Promise<SessionOpenResult>;
    resume(args: ResumeSessionArgs): Promise<SessionOpenResult>;
    restart(args: RestartSessionArgs): Promise<SessionOpenResult>;
    rename(args: RenameSessionArgs): Promise<SessionSummary>;
    delete(args: DeleteSessionArgs): Promise<void>;
    /** Restarts the agent on a different model, keeping the conversation. */
    setModel(args: SetModelArgs): Promise<SessionOpenResult>;
    setMode(args: { sessionId: string; mode: WorkMode }): Promise<void>;
    list(args?: ListSessionsArgs): Promise<SessionSummary[]>;
    prompt(args: PromptArgs): Promise<void>;
    exportTranscript(args: ExportSessionArgs): Promise<SessionExport>;
    cancel(args: CancelArgs): Promise<void>;
    decidePermission(args: PermissionDecisionArgs): Promise<void>;
    exportRaw(args: ExportSessionArgs): Promise<string>;
    rewind(args: { sessionId: string; userItemId: string; keepUser?: boolean }): Promise<CachedChatItem[]>;
    fork(args: { sessionId: string }): Promise<SessionOpenResult>;
    info(args: ExportSessionArgs): Promise<{
      id: string;
      grokSessionId?: string;
      cwd: string;
      model?: string;
      worktreeLabel?: string;
      messageCount: number;
      branch?: string;
    }>;
    applyWorktree(args: { sessionId: string }): Promise<void>;
    subscribe(listener: (event: SessionEvent) => void): () => void;
  };
  changes: {
    diff(args: DiffArgs): Promise<DiffResult>;
    list(args: DiffListArgs): Promise<FileChangeSummary[]>;
    revert(args: RevertArgs): Promise<void>;
    act(args: {
      sessionId: string;
      relPath: string;
      action: 'stage' | 'unstage' | 'stage-hunk' | 'revert-hunk';
      hunk?: string;
    }): Promise<void>;
    commit(args: { sessionId: string; message: string }): Promise<void>;
    push(args: { sessionId: string }): Promise<string>;
    createPr(args: { sessionId: string; title: string; body?: string }): Promise<string>;
  };
  external: {
    openSafeUrl(args: OpenSafeUrlArgs): Promise<void>;
    openLocalhost(args: { url: string }): Promise<void>;
  };
}
