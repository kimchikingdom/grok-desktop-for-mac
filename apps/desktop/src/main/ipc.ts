import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { ZodType } from 'zod';
import { PathEscapeError, assertSafeExternalUrl, looksExecutable, resolveWithinRoot } from '@grok-desktop/security';
import {
  IpcChannels,
  cancelInput,
  chooseWorkspaceInput,
  createSessionInput,
  diffGetInput,
  diffListInput,
  emptyInput,
  listSessionsInput,
  openRecentWorkspaceInput,
  openSafeUrlInput,
  openLocalhostInput,
  permissionDecisionInput,
  promptInput,
  attachPathsInput,
  deleteSessionInput,
  exportSessionInput,
  pickFilesInput,
  readFileInput,
  readMediaInput,
  readTreeInput,
  renameSessionInput,
  searchFilesInput,
  updateWorkspaceInput,
  writeFileInput,
  saveInboxImageInput,
  revealPathInput,
  extrasInput,
  toggleExtraInput,
  rewindInput,
  forkSessionInput,
  applyWorktreeInput,
  changesActInput,
  commitInput,
  pushInput,
  createPrInput,
  restartSessionInput,
  resumeSessionInput,
  revertInput,
  setModelInput,
  setModeInput,
  type DiffResult,
  type SessionEvent,
  type SessionOpenResult,
  type SessionSummary,
} from '@grok-desktop/shared';
import {
  applyGitHunk,
  collectDiffLineCounts,
  collectGitChangesForScope,
  gitDiffFile,
  gitRestoreFile,
  gitCommit,
  gitCreatePr,
  gitCurrentBranch,
  gitPush,
  gitStageFile,
  pathsInPatch,
  previewFromPatch,
  type ChangeTracker,
  type GitDiffScope,
} from './services/diff.js';
import { grokHome } from './services/cli-sessions.js';
import { parseMcpServers, parseSkillDisabled, setMcpEnabled, setSkillDisabled } from './services/grok-config.js';
import { readMedia, readTree, readWorkspaceFile, resolveAttachablePaths, searchFiles, writeInboxImage, writeWorkspaceFile } from './services/files.js';
import { logger, readDiagnosticLog } from './services/logger.js';
import type { RuntimeService } from './services/runtime.js';
import type { SessionManager } from './services/session-manager.js';
import type { MetadataStore } from './services/store.js';
import { publicIpcError } from './public-error.js';
import { chooseWorkspace, listRecentWorkspaces, openRecentWorkspace, toSummary } from './services/workspace.js';

export type IpcContext = {
  getWindow: () => BrowserWindow | null;
  store: MetadataStore;
  sessions: SessionManager;
  runtime: RuntimeService;
  changes: ChangeTracker;
  emit: (event: SessionEvent) => void;
};

/**
 * Only the app's own main frame may call privileged channels. A window opened
 * by injected content, an <iframe>, or a devtools extension is rejected before
 * the payload is even parsed (spec 8.3).
 */
function assertTrustedSender(event: IpcMainInvokeEvent, context: IpcContext): void {
  const window = context.getWindow();
  if (!window || window.isDestroyed()) throw new Error('창이 준비되지 않았습니다.');
  if (event.sender.id !== window.webContents.id) {
    logger.security('알 수 없는 sender의 IPC 호출을 거부했습니다.', { senderId: event.sender.id });
    throw new Error('허용되지 않은 요청입니다.');
  }
  const frame = event.senderFrame;
  if (frame && frame !== window.webContents.mainFrame) {
    logger.security('메인 프레임이 아닌 곳에서 온 IPC 호출을 거부했습니다.', { url: frame.url });
    throw new Error('허용되지 않은 요청입니다.');
  }
}

export function registerIpcHandlers(context: IpcContext): void {
  const handle = <TSchema extends ZodType>(
    channel: string,
    schema: TSchema,
    handler: (input: TSchema['_output']) => Promise<unknown>,
  ): void => {
    ipcMain.handle(channel, async (event, raw: unknown) => {
      assertTrustedSender(event, context);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        logger.security('IPC 입력 검증에 실패했습니다.', { channel, issues: parsed.error.message });
        throw new Error('요청 형식이 올바르지 않습니다.');
      }
      try {
        return await handler(parsed.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A refused path escape is a security event, not routine noise: the
        // diagnostic log is where a reviewer looks for attempts like this.
        if (error instanceof PathEscapeError) {
          logger.security('작업공간 밖 경로 요청을 거부했습니다.', { channel, reason: message });
        } else {
          logger.warn('IPC 처리 실패', { channel, reason: message });
        }
        throw new Error(publicIpcError(message));
      }
    });
  };

  const { store, sessions, runtime, changes } = context;

  const summarize = (session: ReturnType<MetadataStore['listSessions']>[number]): SessionSummary | null => {
    const workspace = store.getWorkspace(session.workspaceId);
    return workspace
      ? { ...session, workspace: toSummary(workspace), live: sessions.isLive(session.id) }
      : null;
  };

  const agentArgs = async () => {
    const status = await runtime.getStatus();
    if (!status.binaryPath) throw new Error('Grok CLI를 찾을 수 없습니다. 먼저 설치해 주세요.');
    const auth = await runtime.getAuthStatus();
    return { binaryPath: status.binaryPath, includeApiKey: auth.method === 'api-key' };
  };

  handle(IpcChannels.authGetStatus, emptyInput, () => runtime.getAuthStatus());
  handle(IpcChannels.authStartLogin, emptyInput, () => runtime.startLogin());
  handle(IpcChannels.runtimeGetStatus, emptyInput, () => runtime.refresh());
  handle(IpcChannels.runtimeInstallRequest, emptyInput, async () => runtime.installInstructions());
  handle(IpcChannels.runtimeExportLog, emptyInput, async () => readDiagnosticLog());

  handle(IpcChannels.workspaceChoose, chooseWorkspaceInput, async (input) => {
    const window = context.getWindow();
    if (!window) throw new Error('창이 준비되지 않았습니다.');
    return chooseWorkspace(store, window, input);
  });
  handle(IpcChannels.workspaceList, emptyInput, () => listRecentWorkspaces(store));
  handle(IpcChannels.workspaceOpenRecent, openRecentWorkspaceInput, (input) =>
    openRecentWorkspace(store, input),
  );
  handle(IpcChannels.workspaceReadTree, readTreeInput, async (input) => {
    const workspace = store.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');
    return readTree(workspace.canonicalRootPath, input.relPath);
  });
  handle(IpcChannels.workspaceReadFile, readFileInput, async (input) => {
    const workspace = store.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');
    return readWorkspaceFile(workspace.canonicalRootPath, input.relPath, input.maxBytes);
  });
  handle(IpcChannels.workspaceSearchFiles, searchFilesInput, async (input) => {
    const workspace = store.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');
    return searchFiles(workspace.canonicalRootPath, input.query, input.limit);
  });
  handle(IpcChannels.workspacePickFiles, pickFilesInput, async (input) => {
    const workspace = store.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');
    const window = context.getWindow();
    if (!window) throw new Error('창이 준비되지 않았습니다.');
    const result = await dialog.showOpenDialog(window, {
      title: '첨부할 파일 선택',
      defaultPath: workspace.canonicalRootPath,
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return resolveAttachablePaths(workspace.canonicalRootPath, result.filePaths);
  });
  handle(IpcChannels.workspaceAttachPaths, attachPathsInput, async (input) => {
    const workspace = store.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');
    return resolveAttachablePaths(workspace.canonicalRootPath, input.paths);
  });
  handle(IpcChannels.workspaceReadMedia, readMediaInput, async (input) => {
    const workspace = store.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');
    return readMedia(workspace.canonicalRootPath, input.relPath);
  });
  handle(IpcChannels.workspaceUpdate, updateWorkspaceInput, async (input) => {
    const patch: {
      permissionProfile?: typeof input.permissionProfile;
      customInstructions?: string;
      sandbox?: typeof input.sandbox;
    } = {};
    if (input.permissionProfile) patch.permissionProfile = input.permissionProfile;
    if (input.sandbox) patch.sandbox = input.sandbox;
    if (input.customInstructions !== undefined) {
      patch.customInstructions = input.customInstructions?.trim() || undefined;
    }
    const updated = store.updateWorkspace(input.workspaceId, patch);
    if (!updated) throw new Error('작업공간을 찾을 수 없습니다.');
    sessions.applyWorkspace(updated);
    return toSummary(updated);
  });
  handle(IpcChannels.workspaceWriteFile, writeFileInput, async (input) => {
    const workspace = store.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');
    await writeWorkspaceFile(workspace.canonicalRootPath, input.relPath, input.content);
    return undefined;
  });
  handle(IpcChannels.workspaceSaveInboxImage, saveInboxImageInput, async (input) => {
    const workspace = store.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');
    const bytes = Buffer.from(input.data, 'base64');
    return writeInboxImage(workspace.canonicalRootPath, input.mime, bytes);
  });
  handle(IpcChannels.workspaceReveal, revealPathInput, async (input) => {
    const workspace = store.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');
    const resolved = await resolveWithinRoot(workspace.canonicalRootPath, input.relPath);
    shell.showItemInFolder(resolved.canonicalPath);
    return undefined;
  });
  handle(IpcChannels.workspaceOpenPath, revealPathInput, async (input) => {
    const workspace = store.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');
    const resolved = await resolveWithinRoot(workspace.canonicalRootPath, input.relPath);
    if (looksExecutable(resolved.relPath)) {
      logger.security('실행 가능한 파일 열기를 거부했습니다.', { relPath: resolved.relPath });
      throw new Error('실행될 수 있는 파일은 앱에서 열지 않습니다. Finder에서 확인해 주세요.');
    }
    const error = await shell.openPath(resolved.canonicalPath);
    if (error) throw new Error(`이 파일을 열지 못했습니다: ${error}`);
    return undefined;
  });
  handle(IpcChannels.workspaceExtras, extrasInput, async (input) => listExtras(store, input.workspaceId));
  handle(IpcChannels.workspaceToggleExtra, toggleExtraInput, async (input) => {
    const extras = await listExtras(store, input.workspaceId);
    if (input.kind === 'mcp' && !extras.mcp.some((entry) => entry.name === input.name)) {
      throw new Error('목록에 없는 MCP 서버입니다.');
    }
    if (input.kind === 'skill' && !extras.skills.some((entry) => entry.name === input.name)) {
      throw new Error('목록에 없는 스킬입니다.');
    }
    const { chmod, readFile, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const file = join(grokHome(), 'config.toml');
    const raw = await readFile(file, 'utf8').catch(() => '');
    const next =
      input.kind === 'mcp'
        ? setMcpEnabled(raw, input.name, input.enabled)
        : setSkillDisabled(raw, input.name, !input.enabled);
    await writeFile(file, next, { encoding: 'utf8', mode: 0o600 });
    await chmod(file, 0o600).catch(() => undefined);
    return listExtras(store, input.workspaceId);
  });

  handle(IpcChannels.sessionCreate, createSessionInput, async (input): Promise<SessionOpenResult> => {
    const workspace = store.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('작업공간을 찾을 수 없습니다.');
    const created = await sessions.create({
      workspace,
      mode: input.mode,
      title: input.title,
      model: input.model,
      isolation: input.isolation,
      ...(await agentArgs()),
    });
    return {
      session: { ...created, live: true },
      items: [],
      changes: [],
      agentContext: 'fresh',
    };
  });
  handle(IpcChannels.sessionResume, resumeSessionInput, async (input) =>
    sessions.resume({ sessionId: input.sessionId, mode: input.mode, ...(await agentArgs()) }),
  );
  handle(IpcChannels.sessionRestart, restartSessionInput, async (input) =>
    sessions.restart({ sessionId: input.sessionId, ...(await agentArgs()) }),
  );
  handle(IpcChannels.sessionRename, renameSessionInput, async (input) =>
    sessions.rename(input.sessionId, input.title),
  );
  handle(IpcChannels.sessionDelete, deleteSessionInput, async (input) => {
    await sessions.delete(input.sessionId);
    return undefined;
  });
  handle(IpcChannels.sessionExport, exportSessionInput, async (input) => sessions.exportTranscriptAsync(input.sessionId));
  handle(IpcChannels.sessionExportRaw, exportSessionInput, async (input) => sessions.exportRawJsonl(input.sessionId));
  handle(IpcChannels.sessionRewind, rewindInput, async (input) =>
    sessions.rewindToUser(input.sessionId, input.userItemId, input.keepUser ?? true),
  );
  handle(IpcChannels.sessionFork, forkSessionInput, async (input) => {
    const record = store.getSession(input.sessionId);
    const workspace = record ? store.getWorkspace(record.workspaceId) : undefined;
    if (!record || !workspace) throw new Error('세션을 찾을 수 없습니다.');
    return sessions.fork(input.sessionId, { workspace, mode: record.mode, ...(await agentArgs()) });
  });
  handle(IpcChannels.sessionInfo, exportSessionInput, async (input) => {
    const info = sessions.sessionInfo(input.sessionId);
    const branch = info.cwd ? await gitCurrentBranch(info.cwd) : null;
    return { ...info, branch: branch ?? undefined };
  });
  handle(IpcChannels.sessionApplyWorktree, applyWorktreeInput, async (input) => {
    await sessions.applyWorktree(input.sessionId);
    return undefined;
  });
  handle(IpcChannels.sessionSetModel, setModelInput, async (input) =>
    sessions.setModel({ sessionId: input.sessionId, model: input.model, ...(await agentArgs()) }),
  );
  handle(IpcChannels.sessionSetMode, setModeInput, async (input) => {
    sessions.setWorkMode(input.sessionId, input.mode);
    return undefined;
  });
  handle(IpcChannels.sessionList, listSessionsInput, async (input) => {
    const workspace = input.workspaceId ? store.getWorkspace(input.workspaceId) : null;
    const cli = workspace ? await sessions.importCliSessions(workspace) : [];
    const previews = new Map(cli.map((entry) => [entry.id, entry]));
    return store
      .listSessions()
      .filter((session) => !input.workspaceId || session.workspaceId === input.workspaceId)
      .filter((session) => input.includeClosed || session.status !== 'closed')
      .map((session) => {
        const summary = summarize(session);
        if (!summary) return null;
        const extra = session.grokSessionId ? previews.get(session.grokSessionId) : undefined;
        return extra
          ? {
              ...summary,
              fromCli: true,
              preview: extra.preview,
              searchText: extra.searchText,
              updatedAt: extra.updatedAt,
            }
          : summary;
      })
      .filter((value): value is SessionSummary => value !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
  handle(IpcChannels.sessionPrompt, promptInput, async (input) => {
    await sessions.prompt(input);
    return undefined;
  });
  handle(IpcChannels.sessionCancel, cancelInput, async (input) => {
    sessions.cancel(input.sessionId);
    return undefined;
  });
  handle(IpcChannels.sessionPermissionDecision, permissionDecisionInput, async (input) => {
    await sessions.decide(input);
    return undefined;
  });

  handle(IpcChannels.diffGet, diffGetInput, async (input): Promise<DiffResult> => {
    const workspace = sessions.getWorkspace(input.sessionId);
    if (!workspace) throw new Error('세션을 찾을 수 없습니다.');

    const resolved = await resolveWithinRoot(workspace.canonicalRootPath, input.relPath);
    const relPath = resolved.relPath ?? input.relPath;
    const scope = input.scope ?? 'turn';

    if (scope === 'turn') {
      const tracked = changes.getPreview(input.sessionId, relPath);
      if (tracked) {
        return { relPath, preview: tracked, view: input.view, revertable: true };
      }
    }

    const gitScope: GitDiffScope = scope === 'turn' ? 'working' : scope;
    const patch = await gitDiffFile(workspace.canonicalRootPath, relPath, gitScope);
    if (!patch) throw new Error('이 파일의 변경 내용을 찾을 수 없습니다.');
    return {
      relPath,
      preview: previewFromPatch(relPath, workspace.canonicalRootPath, patch),
      view: input.view,
      revertable: scope !== 'branch',
    };
  });

  handle(IpcChannels.diffList, diffListInput, async (input) => {
    const workspace = sessions.getWorkspace(input.sessionId);
    if (!workspace) throw new Error('세션을 찾을 수 없습니다.');
    if (input.scope === 'turn') return sessions.openResult(input.sessionId)?.changes ?? changes.listChanges(input.sessionId);
    const listed = await collectGitChangesForScope(workspace.canonicalRootPath, input.scope);
    const counts = await collectDiffLineCounts(workspace.canonicalRootPath, input.scope, listed);
    return listed.map((entry) => ({
      path: `${workspace.canonicalRootPath}/${entry.relPath}`,
      relPath: entry.relPath,
      status: entry.status,
      additions: counts.get(entry.relPath)?.additions ?? 0,
      deletions: counts.get(entry.relPath)?.deletions ?? 0,
      revertable: input.scope !== 'branch',
    }));
  });

  handle(IpcChannels.changesRevert, revertInput, async (input) => {
    const workspace = sessions.getWorkspace(input.sessionId);
    if (!workspace) throw new Error('세션을 찾을 수 없습니다.');
    // `git restore` runs with the workspace as its cwd but resolves paths against
    // the whole repository, so a relPath has to be contained before it gets there.
    const resolved = await resolveWithinRoot(workspace.canonicalRootPath, input.relPath);
    const scope = input.scope ?? 'turn';
    if (scope === 'turn' && changes.isRevertable(input.sessionId, resolved.relPath)) {
      await changes.revert(input.sessionId, resolved.relPath);
    } else if (scope !== 'branch') {
      const ok = await gitRestoreFile(
        workspace.canonicalRootPath,
        resolved.relPath,
        scope === 'staged' ? 'staged' : 'working',
      );
      if (!ok) throw new Error('Git으로 이 파일을 되돌리지 못했습니다.');
    } else {
      throw new Error('브랜치 범위는 되돌릴 수 없습니다.');
    }
    sessions.forgetChange(input.sessionId, resolved.relPath);
    return undefined;
  });

  handle(IpcChannels.changesAct, changesActInput, async (input) => {
    const workspace = sessions.getWorkspace(input.sessionId);
    if (!workspace) throw new Error('세션을 찾을 수 없습니다.');
    const resolved = await resolveWithinRoot(workspace.canonicalRootPath, input.relPath);
    if (input.action === 'stage' || input.action === 'unstage') {
      await gitStageFile(workspace.canonicalRootPath, resolved.relPath, input.action === 'stage');
      return undefined;
    }
    if (!input.hunk) throw new Error('이 파일의 조각을 찾지 못했습니다.');
    // The patch text names its own files, and `git apply` honours those names
    // rather than the relPath above, so every path it touches is contained too.
    for (const candidate of pathsInPatch(input.hunk)) {
      await resolveWithinRoot(workspace.canonicalRootPath, candidate);
    }
    await applyGitHunk(
      workspace.canonicalRootPath,
      input.hunk,
      input.action === 'stage-hunk' ? 'stage' : 'revert',
    );
    return undefined;
  });

  handle(IpcChannels.changesCommit, commitInput, async (input) => {
    const workspace = sessions.getWorkspace(input.sessionId);
    if (!workspace) throw new Error('세션을 찾을 수 없습니다.');
    await gitCommit(workspace.canonicalRootPath, input.message);
    return undefined;
  });
  handle(IpcChannels.changesPush, pushInput, async (input) => {
    const workspace = sessions.getWorkspace(input.sessionId);
    if (!workspace) throw new Error('세션을 찾을 수 없습니다.');
    return gitPush(workspace.canonicalRootPath);
  });
  handle(IpcChannels.changesCreatePr, createPrInput, async (input) => {
    const workspace = sessions.getWorkspace(input.sessionId);
    if (!workspace) throw new Error('세션을 찾을 수 없습니다.');
    return gitCreatePr(workspace.canonicalRootPath, input.title, input.body ?? '');
  });

  handle(IpcChannels.externalOpenSafeUrl, openSafeUrlInput, async (input) => {
    const url = assertSafeExternalUrl(input.url);
    await shell.openExternal(url.toString());
    logger.info('외부 링크를 열었습니다.', { url: url.toString() });
    return undefined;
  });
  handle(IpcChannels.externalOpenLocalhost, openLocalhostInput, async (input) => {
    const { parseLocalhostUrl } = await import('@grok-desktop/shared');
    const url = parseLocalhostUrl(input.url);
    if (!url) throw new Error('루프백 주소만 열 수 있습니다.');
    await shell.openExternal(url);
    return undefined;
  });
}

async function listExtras(store: MetadataStore, workspaceId: string) {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const raw = await readFile(join(grokHome(), 'config.toml'), 'utf8').catch(() => '');
  const mcp = parseMcpServers(raw);
  const disabled = new Set(parseSkillDisabled(raw));
  const skills: { name: string; source: string; enabled: boolean }[] = [];
  const workspace = store.getWorkspace(workspaceId);
  const skillRoots = [
    { dir: join(grokHome(), 'skills'), source: '사용자' },
    ...(workspace ? [{ dir: join(workspace.canonicalRootPath, '.grok', 'skills'), source: '프로젝트' }] : []),
  ];
  for (const root of skillRoots) {
    const entries = await readdir(root.dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skill = await readFile(join(root.dir, entry.name, 'SKILL.md'), 'utf8').catch(() => '');
      if (skill) skills.push({ name: entry.name, source: root.source, enabled: !disabled.has(entry.name) });
    }
  }
  return { mcp, skills };
}

export function removeIpcHandlers(): void {
  for (const channel of Object.values(IpcChannels)) {
    ipcMain.removeHandler(channel);
  }
}
