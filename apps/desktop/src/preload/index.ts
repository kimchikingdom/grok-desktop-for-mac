import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IpcChannels } from '@grok-desktop/shared/channels';
import type { DesktopBridge, SessionEvent } from '@grok-desktop/shared';

/**
 * The entire renderer-visible surface. There is deliberately no generic
 * `send(channel, payload)`: every method below maps to one fixed channel that
 * the main process validates with a schema (spec 5.1, 12).
 */
const bridge: DesktopBridge = {
  auth: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.authGetStatus),
    startLogin: () => ipcRenderer.invoke(IpcChannels.authStartLogin),
  },
  runtime: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.runtimeGetStatus),
    installInstructions: () => ipcRenderer.invoke(IpcChannels.runtimeInstallRequest),
    exportLog: () => ipcRenderer.invoke(IpcChannels.runtimeExportLog),
  },
  workspace: {
    choose: (args) => ipcRenderer.invoke(IpcChannels.workspaceChoose, args ?? {}),
    listRecent: () => ipcRenderer.invoke(IpcChannels.workspaceList),
    openRecent: (args) => ipcRenderer.invoke(IpcChannels.workspaceOpenRecent, args),
    readTree: (args) => ipcRenderer.invoke(IpcChannels.workspaceReadTree, args),
    readFile: (args) => ipcRenderer.invoke(IpcChannels.workspaceReadFile, args),
    searchFiles: (args) => ipcRenderer.invoke(IpcChannels.workspaceSearchFiles, args),
    pickFiles: (args) => ipcRenderer.invoke(IpcChannels.workspacePickFiles, args),
    attachPaths: (args) => ipcRenderer.invoke(IpcChannels.workspaceAttachPaths, args),
    attachDropped: (workspaceId, files) => {
      const paths = files
        .map((file) => {
          try {
            return webUtils.getPathForFile(file);
          } catch {
            return '';
          }
        })
        .filter(Boolean);
      if (paths.length === 0) return Promise.resolve([]);
      return ipcRenderer.invoke(IpcChannels.workspaceAttachPaths, { workspaceId, paths });
    },
    readMedia: (args) => ipcRenderer.invoke(IpcChannels.workspaceReadMedia, args),
    update: (args) => ipcRenderer.invoke(IpcChannels.workspaceUpdate, args),
    writeFile: (args) => ipcRenderer.invoke(IpcChannels.workspaceWriteFile, args),
    saveInboxImage: (args) => ipcRenderer.invoke(IpcChannels.workspaceSaveInboxImage, args),
    reveal: (args) => ipcRenderer.invoke(IpcChannels.workspaceReveal, args),
    openPath: (args) => ipcRenderer.invoke(IpcChannels.workspaceOpenPath, args),
    extras: (args) => ipcRenderer.invoke(IpcChannels.workspaceExtras, args),
    toggleExtra: (args) => ipcRenderer.invoke(IpcChannels.workspaceToggleExtra, args),
  },
  session: {
    create: (args) => ipcRenderer.invoke(IpcChannels.sessionCreate, args),
    resume: (args) => ipcRenderer.invoke(IpcChannels.sessionResume, args),
    restart: (args) => ipcRenderer.invoke(IpcChannels.sessionRestart, args),
    rename: (args) => ipcRenderer.invoke(IpcChannels.sessionRename, args),
    delete: (args) => ipcRenderer.invoke(IpcChannels.sessionDelete, args),
    setModel: (args) => ipcRenderer.invoke(IpcChannels.sessionSetModel, args),
    setMode: (args) => ipcRenderer.invoke(IpcChannels.sessionSetMode, args),
    list: (args) => ipcRenderer.invoke(IpcChannels.sessionList, args ?? {}),
    prompt: (args) => ipcRenderer.invoke(IpcChannels.sessionPrompt, args),
    exportTranscript: (args) => ipcRenderer.invoke(IpcChannels.sessionExport, args),
    cancel: (args) => ipcRenderer.invoke(IpcChannels.sessionCancel, args),
    decidePermission: (args) => ipcRenderer.invoke(IpcChannels.sessionPermissionDecision, args),
    exportRaw: (args) => ipcRenderer.invoke(IpcChannels.sessionExportRaw, args),
    rewind: (args) => ipcRenderer.invoke(IpcChannels.sessionRewind, args),
    fork: (args) => ipcRenderer.invoke(IpcChannels.sessionFork, args),
    info: (args) => ipcRenderer.invoke(IpcChannels.sessionInfo, args),
    applyWorktree: (args) => ipcRenderer.invoke(IpcChannels.sessionApplyWorktree, args),
    subscribe: (listener: (event: SessionEvent) => void) => {
      const handler = (_event: unknown, payload: SessionEvent) => listener(payload);
      ipcRenderer.on(IpcChannels.sessionEvent, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.sessionEvent, handler);
      };
    },
  },
  changes: {
    diff: (args) => ipcRenderer.invoke(IpcChannels.diffGet, args),
    list: (args) => ipcRenderer.invoke(IpcChannels.diffList, args),
    revert: (args) => ipcRenderer.invoke(IpcChannels.changesRevert, args),
    act: (args) => ipcRenderer.invoke(IpcChannels.changesAct, args),
    commit: (args) => ipcRenderer.invoke(IpcChannels.changesCommit, args),
    push: (args) => ipcRenderer.invoke(IpcChannels.changesPush, args),
    createPr: (args) => ipcRenderer.invoke(IpcChannels.changesCreatePr, args),
  },
  external: {
    openSafeUrl: (args) => ipcRenderer.invoke(IpcChannels.externalOpenSafeUrl, args),
    openLocalhost: (args) => ipcRenderer.invoke(IpcChannels.externalOpenLocalhost, args),
  },
};

contextBridge.exposeInMainWorld('grokDesktop', bridge);
