import { z } from 'zod';
import { IpcChannels } from './channels.js';

/**
 * Every privileged channel has exactly one input schema (spec section 12).
 * There is no generic `ipc.send(channel, payload)`: the preload bridge only
 * forwards the fixed channel names, and the main process rejects any payload
 * that does not parse here.
 */
const nonEmpty = z.string().min(1).max(4096);
const id = z.string().min(1).max(200);

export const emptyInput = z.undefined().or(z.null()).transform(() => undefined);

export const chooseWorkspaceInput = z
  .object({
    /** Set after the user acknowledged a 'warn' verdict for this exact path. */
    confirmedPath: nonEmpty.optional(),
    permissionProfile: z.enum(['read-only', 'ask', 'trusted']).optional(),
  })
  .strict();

export const openRecentWorkspaceInput = z
  .object({
    workspaceId: id,
    permissionProfile: z.enum(['read-only', 'ask', 'trusted']).optional(),
  })
  .strict();

export const readTreeInput = z
  .object({
    workspaceId: id,
    /** Workspace-relative directory. '' or '.' means the root. */
    relPath: z.string().max(4096).default(''),
  })
  .strict();

export const readFileInput = z
  .object({
    workspaceId: id,
    relPath: z.string().min(1).max(4096),
    maxBytes: z.number().int().positive().max(2_000_000).optional(),
  })
  .strict();

export const searchFilesInput = z
  .object({
    workspaceId: id,
    query: z.string().max(200),
    limit: z.number().int().positive().max(80).optional(),
  })
  .strict();

export const pickFilesInput = z.object({ workspaceId: id }).strict();

export const attachPathsInput = z
  .object({
    workspaceId: id,
    paths: z.array(z.string().min(1).max(4096)).min(1).max(20),
  })
  .strict();

export const readMediaInput = z
  .object({
    workspaceId: id,
    relPath: z.string().min(1).max(4096),
  })
  .strict();

export const updateWorkspaceInput = z
  .object({
    workspaceId: id,
    permissionProfile: z.enum(['read-only', 'ask', 'trusted']).optional(),
    customInstructions: z.string().max(8_000).nullable().optional(),
    sandbox: z.enum(['off', 'workspace', 'read-only', 'strict']).optional(),
  })
  .strict();

export const promptToolFlag = z.enum(['imagine', 'imagine-video', 'think', 'deep-research']);

/** Model ids come straight from the agent's catalogue, so keep them tight. */
const modelId = z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);

export const createSessionInput = z
  .object({
    workspaceId: id,
    mode: z.enum(['ask', 'plan', 'agent']).default('ask'),
    title: z.string().max(200).optional(),
    model: modelId.optional(),
    isolation: z.enum(['none', 'worktree']).optional(),
  })
  .strict();

export const setModelInput = z
  .object({
    sessionId: id,
    model: modelId,
  })
  .strict();

export const setModeInput = z
  .object({
    sessionId: id,
    mode: z.enum(['ask', 'plan', 'agent']),
  })
  .strict();

export const listSessionsInput = z.preprocess(
  (value) => value ?? {},
  z
    .object({
      workspaceId: id.optional(),
      includeClosed: z.boolean().optional(),
    })
    .strict(),
);

export const resumeSessionInput = z
  .object({
    sessionId: id,
    mode: z.enum(['ask', 'plan', 'agent']).optional(),
  })
  .strict();

export const restartSessionInput = z.object({ sessionId: id }).strict();

export const renameSessionInput = z
  .object({
    sessionId: id,
    title: z.string().min(1).max(200),
  })
  .strict();

export const promptInput = z
  .object({
    sessionId: id,
    text: z.string().min(1).max(200_000),
    /** Workspace-relative paths the user explicitly attached with @file. */
    attachments: z.array(z.string().min(1).max(4096)).max(50).default([]),
    tools: z.array(promptToolFlag).max(4).default([]),
    mode: z.enum(['ask', 'plan', 'agent']).optional(),
    /** Re-run the last user turn instead of appending another one. */
    regenerate: z.boolean().optional(),
    /** Renderer-generated id so rewind/edit can address the optimistic bubble. */
    clientItemId: id.optional(),
    /** Prefix a side question so the agent does not change the current task. */
    sideAsk: z.boolean().optional(),
  })
  .strict();

export const deleteSessionInput = z.object({ sessionId: id }).strict();

export const exportSessionInput = z.object({ sessionId: id }).strict();

export const cancelInput = z.object({ sessionId: id }).strict();

export const permissionDecisionInput = z
  .object({
    sessionId: id,
    requestId: id,
    optionId: id,
    /**
     * Scope is decided by the app, not by the agent: the renderer sends what the
     * user clicked and the main process maps it back onto an agent option id.
     */
    scope: z.enum(['once', 'session', 'deny']),
  })
  .strict();

const diffScope = z.enum(['turn', 'working', 'staged', 'branch']);

export const diffGetInput = z
  .object({
    sessionId: id,
    relPath: z.string().min(1).max(4096),
    view: z.enum(['unified', 'split']).default('unified'),
    scope: diffScope.optional(),
  })
  .strict();

export const diffListInput = z
  .object({
    sessionId: id,
    scope: diffScope.default('working'),
  })
  .strict();

export const revertInput = z
  .object({
    sessionId: id,
    relPath: z.string().min(1).max(4096),
    scope: diffScope.optional(),
  })
  .strict();

export const writeFileInput = z
  .object({
    workspaceId: id,
    relPath: z.string().min(1).max(4096),
    content: z.string().max(2_000_000),
  })
  .strict();

export const saveInboxImageInput = z
  .object({
    workspaceId: id,
    mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    data: z.string().min(1).max(6_000_000),
  })
  .strict();

export const revealPathInput = z
  .object({
    workspaceId: id,
    relPath: z.string().min(1).max(4096),
  })
  .strict();

export const extrasInput = z.object({ workspaceId: id }).strict();

export const rewindInput = z
  .object({ sessionId: id, userItemId: id, keepUser: z.boolean().optional() })
  .strict();

export const toggleExtraInput = z
  .object({
    workspaceId: id,
    kind: z.enum(['mcp', 'skill']),
    name: z.string().min(1).max(200),
    enabled: z.boolean(),
  })
  .strict();

export const forkSessionInput = z.object({ sessionId: id }).strict();

export const applyWorktreeInput = z.object({ sessionId: id }).strict();

export const commitInput = z
  .object({
    sessionId: id,
    message: z.string().min(1).max(4_000),
  })
  .strict();

export const pushInput = z.object({ sessionId: id }).strict();

export const createPrInput = z
  .object({
    sessionId: id,
    title: z.string().min(1).max(200),
    body: z.string().max(8_000).optional(),
  })
  .strict();

export const changesActInput = z
  .object({
    sessionId: id,
    relPath: z.string().min(1).max(4096),
    action: z.enum(['stage', 'unstage', 'stage-hunk', 'revert-hunk']),
    hunk: z.string().max(200_000).optional(),
  })
  .strict();

export const openSafeUrlInput = z
  .object({
    url: z.string().url().max(2048),
  })
  .strict();

export const openLocalhostInput = z.object({ url: z.string().url().max(2048) }).strict();

export const ipcInputSchemas = {
  [IpcChannels.authGetStatus]: emptyInput,
  [IpcChannels.authStartLogin]: emptyInput,
  [IpcChannels.runtimeGetStatus]: emptyInput,
  [IpcChannels.runtimeInstallRequest]: emptyInput,
  [IpcChannels.runtimeExportLog]: emptyInput,
  [IpcChannels.workspaceChoose]: chooseWorkspaceInput,
  [IpcChannels.workspaceList]: emptyInput,
  [IpcChannels.workspaceOpenRecent]: openRecentWorkspaceInput,
  [IpcChannels.workspaceReadTree]: readTreeInput,
  [IpcChannels.workspaceReadFile]: readFileInput,
  [IpcChannels.workspaceSearchFiles]: searchFilesInput,
  [IpcChannels.workspacePickFiles]: pickFilesInput,
  [IpcChannels.workspaceAttachPaths]: attachPathsInput,
  [IpcChannels.workspaceReadMedia]: readMediaInput,
  [IpcChannels.workspaceUpdate]: updateWorkspaceInput,
  [IpcChannels.workspaceWriteFile]: writeFileInput,
  [IpcChannels.workspaceSaveInboxImage]: saveInboxImageInput,
  [IpcChannels.workspaceReveal]: revealPathInput,
  [IpcChannels.workspaceOpenPath]: revealPathInput,
  [IpcChannels.workspaceExtras]: extrasInput,
  [IpcChannels.workspaceToggleExtra]: toggleExtraInput,
  [IpcChannels.sessionCreate]: createSessionInput,
  [IpcChannels.sessionResume]: resumeSessionInput,
  [IpcChannels.sessionRestart]: restartSessionInput,
  [IpcChannels.sessionRename]: renameSessionInput,
  [IpcChannels.sessionDelete]: deleteSessionInput,
  [IpcChannels.sessionSetModel]: setModelInput,
  [IpcChannels.sessionSetMode]: setModeInput,
  [IpcChannels.sessionPrompt]: promptInput,
  [IpcChannels.sessionCancel]: cancelInput,
  [IpcChannels.sessionList]: listSessionsInput,
  [IpcChannels.sessionPermissionDecision]: permissionDecisionInput,
  [IpcChannels.sessionExport]: exportSessionInput,
  [IpcChannels.sessionExportRaw]: exportSessionInput,
  [IpcChannels.sessionRewind]: rewindInput,
  [IpcChannels.sessionFork]: forkSessionInput,
  [IpcChannels.sessionInfo]: exportSessionInput,
  [IpcChannels.sessionApplyWorktree]: applyWorktreeInput,
  [IpcChannels.diffGet]: diffGetInput,
  [IpcChannels.diffList]: diffListInput,
  [IpcChannels.changesRevert]: revertInput,
  [IpcChannels.changesAct]: changesActInput,
  [IpcChannels.changesCommit]: commitInput,
  [IpcChannels.changesPush]: pushInput,
  [IpcChannels.changesCreatePr]: createPrInput,
  [IpcChannels.externalOpenSafeUrl]: openSafeUrlInput,
  [IpcChannels.externalOpenLocalhost]: openLocalhostInput,
} as const;

export type ChooseWorkspaceInput = z.infer<typeof chooseWorkspaceInput>;
export type OpenRecentWorkspaceInput = z.infer<typeof openRecentWorkspaceInput>;
export type ReadTreeInput = z.infer<typeof readTreeInput>;
export type ReadFileInput = z.infer<typeof readFileInput>;
export type CreateSessionInput = z.infer<typeof createSessionInput>;
export type ListSessionsInput = z.infer<typeof listSessionsInput>;
export type ResumeSessionInput = z.infer<typeof resumeSessionInput>;
export type RestartSessionInput = z.infer<typeof restartSessionInput>;
export type RenameSessionInput = z.infer<typeof renameSessionInput>;
export type SetModelInput = z.infer<typeof setModelInput>;
export type PromptInput = z.infer<typeof promptInput>;
export type CancelInput = z.infer<typeof cancelInput>;
export type PermissionDecision = z.infer<typeof permissionDecisionInput>;
export type DiffGetInput = z.infer<typeof diffGetInput>;
export type DiffListInput = z.infer<typeof diffListInput>;
export type RevertInput = z.infer<typeof revertInput>;
export type DiffScope = z.infer<typeof diffGetInput>['scope'];
export type OpenSafeUrlInput = z.infer<typeof openSafeUrlInput>;
export type PromptToolFlag = z.infer<typeof promptToolFlag>;
export type SearchFilesInput = z.infer<typeof searchFilesInput>;
export type PickFilesInput = z.infer<typeof pickFilesInput>;
export type AttachPathsInput = z.infer<typeof attachPathsInput>;
export type ReadMediaInput = z.infer<typeof readMediaInput>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInput>;
export type DeleteSessionInput = z.infer<typeof deleteSessionInput>;
export type ExportSessionInput = z.infer<typeof exportSessionInput>;
