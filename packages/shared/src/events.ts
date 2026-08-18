import type {
  ModelInfo,
  RiskLevel,
  RuntimeStatus,
  SessionStatus,
  SessionSummary,
  UsageSnapshot,
} from './domain.js';
import type { CachedChatItem } from './transcript.js';

/** What a tool call does, normalised away from Grok's raw tool names. */
export type ToolKind =
  | 'read'
  | 'search'
  | 'edit'
  | 'delete'
  | 'move'
  | 'execute'
  | 'fetch'
  | 'think'
  | 'other';

export type ToolCallStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'denied';

export type ToolMedia = {
  kind: 'image' | 'video';
  mimeType?: string;
  /** Workspace-relative path when the file lives inside the project. */
  relPath?: string;
  /** Transient preview; stripped before the transcript is written to disk. */
  dataUrl?: string;
};

export type ToolLocation = {
  path: string;
  /** Path relative to the workspace root, or undefined when outside it. */
  relPath?: string;
  line?: number;
  insideWorkspace: boolean;
};

export type ToolCallView = {
  id: string;
  kind: ToolKind;
  title: string;
  status: ToolCallStatus;
  locations: ToolLocation[];
  /** Command string for execute-kind calls, already masked for secrets. */
  command?: string;
  cwd?: string;
  /** Masked textual output produced by the tool. */
  output?: string;
  /** Generated or returned media the UI can render inline. */
  media?: ToolMedia[];
  exitCode?: number;
  error?: string;
  startedAt: string;
  endedAt?: string;
};

export type DiffPreview = {
  path: string;
  relPath: string;
  unifiedDiff: string;
  additions: number;
  deletions: number;
  truncated: boolean;
  binary: boolean;
};

export type FileChangeSummary = {
  path: string;
  relPath: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  /** Set when the app captured a pre-change snapshot and can restore it. */
  revertable: boolean;
};

export type PermissionOptionKind =
  | 'allow-once'
  | 'allow-session'
  | 'reject-once'
  | 'reject-session';

export type PermissionOption = {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
};

export type PermissionRequestView = {
  id: string;
  sessionId: string;
  toolCallId?: string;
  kind: ToolKind;
  title: string;
  /** Grok's stated reason for the action, when provided. */
  rationale?: string;
  risk: RiskLevel;
  /** Why the app classified this request at that risk level. */
  reasons: string[];
  locations: ToolLocation[];
  command?: string;
  cwd?: string;
  timeoutMs?: number;
  preview?: DiffPreview;
  options: PermissionOption[];
  createdAt: string;
};

export type PlanEntry = {
  content: string;
  status: 'pending' | 'in-progress' | 'completed';
  priority?: 'low' | 'medium' | 'high';
};

export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled'
  | 'error';

/**
 * Everything the main process is allowed to push to the renderer.
 * The renderer treats every field as untrusted display data.
 */
export type SessionEvent =
  | { type: 'session-status'; sessionId: string; status: SessionStatus; detail?: string }
  | { type: 'message-delta'; sessionId: string; messageId: string; channel: 'answer' | 'thought'; text: string }
  | { type: 'message-end'; sessionId: string; messageId: string }
  | { type: 'plan'; sessionId: string; id?: string; entries: PlanEntry[] }
  | { type: 'tool-call'; sessionId: string; call: ToolCallView }
  | { type: 'terminal-output'; sessionId: string; toolCallId: string; stream: 'stdout' | 'stderr'; chunk: string }
  | { type: 'permission-request'; sessionId: string; request: PermissionRequestView }
  | {
      type: 'permission-resolved';
      sessionId: string;
      requestId: string;
      decision: 'approved-once' | 'approved-session' | 'denied' | 'auto-allowed';
    }
  | { type: 'file-changed'; sessionId: string; change: FileChangeSummary }
  | { type: 'turn-ended'; sessionId: string; stopReason: StopReason }
  | { type: 'runtime-status'; status: RuntimeStatus }
  | { type: 'session-updated'; session: SessionSummary }
  | { type: 'models'; sessionId: string; models: ModelInfo[]; currentModelId?: string }
  | { type: 'usage'; sessionId: string; usage: UsageSnapshot }
  | { type: 'transcript-replaced'; sessionId: string; items: CachedChatItem[] }
  | { type: 'focus-session'; sessionId: string }
  | {
      type: 'subagent';
      sessionId: string;
      id: string;
      title: string;
      status: 'running' | 'completed' | 'failed';
      detail?: string;
    }
  | {
      type: 'background-task';
      sessionId: string;
      id: string;
      title: string;
      status: 'running' | 'completed' | 'failed';
    }
  | {
      type: 'error';
      sessionId?: string;
      id?: string;
      code: string;
      message: string;
      recoverable: boolean;
      /** Last stderr lines from the CLI, masked. */
      detail?: string;
    };
