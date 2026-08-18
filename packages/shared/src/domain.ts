/**
 * Core domain records (spec section 10).
 *
 * Auth tokens are never modelled here: they stay inside the Grok CLI / OS keychain.
 */

export type PermissionProfile = 'read-only' | 'ask' | 'trusted';

export type WorkMode = 'ask' | 'plan' | 'agent';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type SessionStatus = 'idle' | 'starting' | 'running' | 'waiting-approval' | 'failed' | 'closed';

export type WorkspaceRecord = {
  id: string;
  rootPath: string;
  canonicalRootPath: string;
  displayName: string;
  permissionProfile: PermissionProfile;
  /** Optional workspace-level custom instructions, prepended to every prompt. */
  customInstructions?: string;
  /** Official CLI `--sandbox` profile for new ACP processes. */
  sandbox?: 'off' | 'workspace' | 'read-only' | 'strict';
  lastSessionId?: string;
  createdAt: string;
  lastOpenedAt: string;
};

export type WorkspaceSummary = {
  id: string;
  displayName: string;
  rootPath: string;
  canonicalRootPath: string;
  permissionProfile: PermissionProfile;
  customInstructions?: string;
  sandbox?: 'off' | 'workspace' | 'read-only' | 'strict';
  lastSessionId?: string;
  lastOpenedAt: string;
  /** Populated when the recorded folder no longer resolves to a directory. */
  missing?: boolean;
};

export type ModelInfo = {
  id: string;
  name: string;
  description?: string;
  /** Context window size, when the agent reports one. */
  contextTokens?: number;
};

/**
 * What the app can honestly say about consumption. The CLI exposes no usage
 * endpoint, so `quota` is only populated after the API reports a limit, while
 * `contextTokens` is known up front from the model catalogue.
 */
export type UsageSnapshot = {
  modelId?: string;
  contextTokens?: number;
  /** Set when a 429 told us the exact rolling-window numbers. */
  quota?: {
    usedTokens: number;
    limitTokens: number;
    observedAt: string;
  };
  /** Turns completed in this session since the app started it. */
  turnsThisSession: number;
};

export type SessionRecord = {
  id: string;
  grokSessionId?: string;
  /** Model id the session was started with; undefined means the agent default. */
  model?: string;
  workspaceId: string;
  title: string;
  mode: WorkMode;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  /** Isolated git worktree this session writes to, when created with isolation. */
  worktreePath?: string;
  worktreeLabel?: string;
};

export type SessionSummary = SessionRecord & {
  workspace: WorkspaceSummary;
  /** True while an ACP child process is attached to this record. */
  live?: boolean;
  /** True when the record was imported from ~/.grok/sessions. */
  fromCli?: boolean;
  /** Short text used for list search. */
  preview?: string;
  /** Lowercased title + summary + user/agent snippets for list search. */
  searchText?: string;
};

export type ApprovalDecisionKind = 'approved-once' | 'approved-session' | 'denied';

export type ApprovalRecord = {
  id: string;
  sessionId: string;
  tool: string;
  target?: string;
  command?: string;
  risk: RiskLevel;
  decision: ApprovalDecisionKind;
  createdAt: string;
};

/** Result of inspecting a folder the user picked, before a session is created. */
export type WorkspaceCandidate = {
  rootPath: string;
  canonicalRootPath: string;
  displayName: string;
  /** 'blocked' folders can never be opened; 'warn' requires an explicit confirmation. */
  verdict: 'ok' | 'warn' | 'blocked';
  reasons: string[];
};

export type RuntimeState =
  | 'not-installed'
  | 'unauthenticated'
  | 'ready'
  | 'starting'
  | 'failed';

export type RuntimeStatus = {
  state: RuntimeState;
  /** Absolute path to the detected `grok` executable. */
  binaryPath?: string;
  version?: string;
  /** Human readable reason when state is 'not-installed' or 'failed'. */
  detail?: string;
  installCommand: string;
  docsUrl: string;
};

export type AuthStatus = {
  authenticated: boolean;
  method?: 'oauth' | 'api-key' | 'unknown';
  account?: string;
  detail?: string;
  /** Device-auth URL, already allow-listed, so the UI can reopen the browser. */
  loginUrl?: string;
  loginCode?: string;
};
