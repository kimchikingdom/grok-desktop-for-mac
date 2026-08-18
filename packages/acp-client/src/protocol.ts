import { z } from 'zod';

/**
 * Schemas for the Agent Client Protocol messages Grok Build speaks over
 * `grok agent stdio`. They are intentionally permissive: unknown fields are
 * dropped rather than rejected, and unknown `sessionUpdate` kinds degrade to an
 * `unsupported` event instead of throwing (spec 17: adapter layer).
 */

export const PROTOCOL_VERSION = 1;

export const contentBlockSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image'), mimeType: z.string().optional(), data: z.string().optional() }),
  z.object({ type: z.literal('resource_link'), uri: z.string(), name: z.string().optional() }),
  z.object({ type: z.string() }),
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const toolKindSchema = z.enum([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
]);

export const toolStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);

export const toolLocationSchema = z.object({
  path: z.string(),
  line: z.number().int().nonnegative().optional(),
});

export const toolCallContentSchema = z.union([
  z.object({ type: z.literal('content'), content: contentBlockSchema }),
  z.object({
    type: z.literal('diff'),
    path: z.string(),
    oldText: z.string().nullable().optional(),
    newText: z.string(),
  }),
  z.object({ type: z.literal('terminal'), terminalId: z.string() }),
  z.object({ type: z.string() }),
]);

export const toolCallSchema = z.object({
  toolCallId: z.string(),
  title: z.string().optional(),
  kind: toolKindSchema.optional(),
  status: toolStatusSchema.optional(),
  content: z.array(toolCallContentSchema).optional(),
  locations: z.array(toolLocationSchema).optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
});
export type AcpToolCall = z.infer<typeof toolCallSchema>;

export const planEntrySchema = z.object({
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']).default('pending'),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});

/**
 * Grok reports its model catalogue in `initialize._meta.modelState`, so the app
 * never has to shell out to `grok models` to populate the picker.
 */
export const modelStateSchema = z.object({
  currentModelId: z.string().optional(),
  availableModels: z
    .array(
      z.object({
        modelId: z.string(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
        _meta: z
          .object({ totalContextTokens: z.number().int().positive().optional() })
          .loose()
          .optional(),
      }),
    )
    .default([]),
});
export type AcpModelState = z.infer<typeof modelStateSchema>;

export const initializeResultSchema = z.object({
  _meta: z.object({ modelState: modelStateSchema.optional() }).loose().optional(),
  protocolVersion: z.union([z.number(), z.string()]).optional(),
  agentCapabilities: z
    .object({
      loadSession: z.boolean().optional(),
      promptCapabilities: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  authMethods: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        description: z.string().nullable().optional(),
      }),
    )
    .optional(),
});
export type InitializeResult = z.infer<typeof initializeResultSchema>;

export const newSessionResultSchema = z.object({
  sessionId: z.string(),
  modes: z.unknown().optional(),
});

export const promptResultSchema = z.object({
  stopReason: z
    .enum(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'])
    .optional(),
});

export const sessionNotificationSchema = z.object({
  sessionId: z.string(),
  update: z.record(z.string(), z.unknown()),
});

export const permissionOptionSchema = z.object({
  optionId: z.string(),
  name: z.string().optional(),
  kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']).optional(),
});
export type AcpPermissionOption = z.infer<typeof permissionOptionSchema>;

export const requestPermissionParamsSchema = z.object({
  sessionId: z.string(),
  toolCall: toolCallSchema.partial({ toolCallId: true }),
  options: z.array(permissionOptionSchema).default([]),
});
export type RequestPermissionParams = z.infer<typeof requestPermissionParamsSchema>;

export const readTextFileParamsSchema = z.object({
  sessionId: z.string(),
  path: z.string(),
  line: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
});

export const writeTextFileParamsSchema = z.object({
  sessionId: z.string(),
  path: z.string(),
  content: z.string(),
});

/** Normalised session updates the rest of the app consumes. */
export type AcpSessionUpdate =
  | { kind: 'agent-message'; text: string }
  | { kind: 'agent-thought'; text: string }
  | { kind: 'user-message'; text: string }
  | { kind: 'tool-call'; call: AcpToolCall; isUpdate: boolean }
  | { kind: 'plan'; entries: z.infer<typeof planEntrySchema>[] }
  | { kind: 'mode'; modeId: string }
  | { kind: 'subagent'; phase: 'spawned' | 'finished'; id: string; title: string; detail?: string }
  | { kind: 'task'; phase: 'backgrounded' | 'completed'; id: string; title: string }
  | { kind: 'unsupported'; sessionUpdate: string; raw: Record<string, unknown> };

function textOf(value: unknown): string {
  const parsed = contentBlockSchema.safeParse(value);
  if (parsed.success && 'text' in parsed.data && typeof parsed.data.text === 'string') {
    return parsed.data.text;
  }
  if (typeof value === 'string') return value;
  return '';
}

export function parseSessionUpdate(update: Record<string, unknown>): AcpSessionUpdate {
  const kind = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : '';

  switch (kind) {
    case 'agent_message_chunk':
      return { kind: 'agent-message', text: textOf(update.content) };
    case 'agent_thought_chunk':
      return { kind: 'agent-thought', text: textOf(update.content) };
    case 'user_message_chunk':
      return { kind: 'user-message', text: textOf(update.content) };
    case 'tool_call':
    case 'tool_call_update': {
      const parsed = toolCallSchema.safeParse(update);
      if (!parsed.success) break;
      return { kind: 'tool-call', call: parsed.data, isUpdate: kind === 'tool_call_update' };
    }
    case 'plan': {
      const parsed = z.array(planEntrySchema).safeParse(update.entries);
      if (!parsed.success) break;
      return { kind: 'plan', entries: parsed.data };
    }
    case 'current_mode_update': {
      const modeId = typeof update.currentModeId === 'string' ? update.currentModeId : '';
      if (modeId) return { kind: 'mode', modeId };
      break;
    }
    case 'subagent_spawned':
    case 'subagent_finished': {
      const id =
        (typeof update.agentId === 'string' && update.agentId) ||
        (typeof update.id === 'string' && update.id) ||
        (typeof update.sessionId === 'string' && update.sessionId) ||
        kind;
      const title =
        (typeof update.title === 'string' && update.title) ||
        (typeof update.name === 'string' && update.name) ||
        (typeof update.agentName === 'string' && update.agentName) ||
        '서브에이전트';
      const detail = typeof update.summary === 'string' ? update.summary : undefined;
      return {
        kind: 'subagent',
        phase: kind === 'subagent_finished' ? 'finished' : 'spawned',
        id,
        title,
        detail,
      };
    }
    case 'auto_compact_started':
    case 'auto_compact_completed':
    case 'compaction_checkpoint':
    case 'retry_state':
      return {
        kind: 'task',
        phase: kind === 'auto_compact_completed' ? 'completed' : 'backgrounded',
        id: kind,
        title:
          kind === 'retry_state'
            ? '재시도'
            : kind === 'auto_compact_completed'
              ? '대화 압축 완료'
              : kind === 'compaction_checkpoint'
                ? '압축 체크포인트'
                : '대화 압축 시작',
      };
    case 'task_backgrounded':
    case 'task_completed': {
      const id =
        (typeof update.taskId === 'string' && update.taskId) ||
        (typeof update.id === 'string' && update.id) ||
        kind;
      const title = (typeof update.title === 'string' && update.title) || '백그라운드 작업';
      return {
        kind: 'task',
        phase: kind === 'task_completed' ? 'completed' : 'backgrounded',
        id,
        title,
      };
    }
    default:
      break;
  }

  return { kind: 'unsupported', sessionUpdate: kind, raw: update };
}

export const AcpMethods = {
  initialize: 'initialize',
  authenticate: 'authenticate',
  newSession: 'session/new',
  loadSession: 'session/load',
  prompt: 'session/prompt',
  cancel: 'session/cancel',
  update: 'session/update',
  requestPermission: 'session/request_permission',
  readTextFile: 'fs/read_text_file',
  writeTextFile: 'fs/write_text_file',
} as const;
