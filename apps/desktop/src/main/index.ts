import path from 'node:path';
import { app, BrowserWindow, Notification, shell } from 'electron';
import { assertSafeExternalUrl } from '@grok-desktop/security';
import { IpcChannels, type SessionEvent, type SessionStatus } from '@grok-desktop/shared';
import { registerIpcHandlers, removeIpcHandlers } from './ipc.js';
import { ChangeTracker } from './services/diff.js';
import { configureLogger, logger } from './services/logger.js';
import { RuntimeService } from './services/runtime.js';
import { SessionManager } from './services/session-manager.js';
import { MetadataStore } from './services/store.js';
import { OrphanRegistry } from './services/orphans.js';
import { OverlayLog } from './services/overlay-log.js';
import { TranscriptStore } from './services/transcript.js';
import { setDockBadge, TrayController } from './tray.js';
import { applyDockIcon, createMainWindow } from './window.js';

let mainWindow: BrowserWindow | null = null;
let sessions: SessionManager | null = null;
let runtime: RuntimeService | null = null;
let store: MetadataStore | null = null;
let orphanRegistry: OrphanRegistry | null = null;
let tray: TrayController | null = null;
const pendingApprovals = new Set<string>();
const approvalSession = new Map<string, string>();
const sessionStatuses = new Map<string, SessionStatus>();

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function windowFocused(): boolean {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused());
}

function notifyDesktop(title: string, body: string, sessionId?: string): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  notification.on('click', () => {
    showWindow();
    if (sessionId && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.sessionEvent, { type: 'focus-session', sessionId });
    }
  });
  notification.show();
}

function refreshTray(): void {
  const statuses = [...sessionStatuses.values()];
  const waiting = statuses.filter((status) => status === 'waiting-approval').length;
  const running = statuses.some((status) => status === 'running');
  const failed = statuses.some((status) => status === 'failed');
  const status: SessionStatus = waiting > 0 ? 'waiting-approval' : running ? 'running' : failed ? 'failed' : 'idle';
  tray?.update({
    status,
    running,
    pendingApprovals: Math.max(pendingApprovals.size, waiting),
  });
  setDockBadge(Math.max(pendingApprovals.size, waiting));
}

/** Mirror the session stream into the menu bar, dock badge, and OS notifications. */
function trackForTray(event: SessionEvent): void {
  switch (event.type) {
    case 'permission-request':
      pendingApprovals.add(event.request.id);
      approvalSession.set(event.request.id, event.sessionId);
      break;
    case 'permission-resolved':
      pendingApprovals.delete(event.requestId);
      approvalSession.delete(event.requestId);
      break;
    case 'session-status': {
      const previous = sessionStatuses.get(event.sessionId);
      sessionStatuses.set(event.sessionId, event.status);
      if (event.status === 'idle' || event.status === 'failed' || event.status === 'closed') {
        for (const [requestId, sessionId] of approvalSession) {
          if (sessionId === event.sessionId) {
            pendingApprovals.delete(requestId);
            approvalSession.delete(requestId);
          }
        }
      }
      if (!windowFocused()) {
        if (event.status === 'waiting-approval' && previous !== 'waiting-approval') {
          notifyDesktop('Grok Desktop', '대화가 승인을 기다립니다.', event.sessionId);
        } else if (event.status === 'idle' && previous === 'running') {
          notifyDesktop('Grok Desktop', '대화가 한 턴을 마쳤습니다.', event.sessionId);
        } else if (event.status === 'failed' && previous && previous !== 'failed') {
          notifyDesktop('Grok Desktop', '대화가 오류로 멈췄습니다.', event.sessionId);
        }
      }
      break;
    }
    case 'session-updated':
      tray?.update({ workspaceName: event.session.workspace.displayName });
      if (event.session.status === 'closed') sessionStatuses.delete(event.session.id);
      break;
    default:
      return;
  }
  refreshTray();
}

function emit(event: SessionEvent): void {
  trackForTray(event);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IpcChannels.sessionEvent, event);
}

async function bootstrap(): Promise<void> {
  configureLogger(path.join(app.getPath('userData'), 'logs'));
  logger.info('Grok Desktop을 시작합니다.', { version: app.getVersion() });

  store = new MetadataStore(path.join(app.getPath('userData'), 'metadata.json'));
  await store.load();

  const changes = new ChangeTracker();
  const transcripts = new TranscriptStore(path.join(app.getPath('userData'), 'sessions'));
  const overlays = new OverlayLog(path.join(app.getPath('userData'), 'overlays'));

  // Anything the previous run left behind (crash, force quit) goes first.
  const orphans = new OrphanRegistry(path.join(app.getPath('userData'), 'agent-pids.json'));
  await orphans.load();
  const reaped = await orphans.reapOrphans();
  if (reaped > 0) logger.info('고아 에이전트를 정리했습니다.', { count: reaped });

  runtime = new RuntimeService(
    (status) => emit({ type: 'runtime-status', status }),
    async (url) => {
      await shell.openExternal(assertSafeExternalUrl(url).toString());
    },
  );
  sessions = new SessionManager(store, changes, emit, transcripts, orphans, overlays);
  orphanRegistry = orphans;

  applyDockIcon();
  mainWindow = createMainWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  tray = new TrayController({
    showWindow,
    cancelRun: () => {
      const waiting = [...sessionStatuses.entries()]
        .filter(([, status]) => status === 'waiting-approval')
        .map(([id]) => id);
      const running = [...sessionStatuses.entries()]
        .filter(([, status]) => status === 'running')
        .map(([id]) => id);
      for (const id of waiting.length > 0 ? waiting : running) {
        if (sessions?.isLive(id)) sessions.cancel(id);
      }
    },
    quit: () => app.quit(),
  });
  tray.start();

  registerIpcHandlers({
    getWindow: () => mainWindow,
    store,
    sessions,
    runtime,
    changes,
    emit,
  });

  void runtime.refresh();
}

async function shutdown(): Promise<void> {
  removeIpcHandlers();
  tray?.dispose();
  tray = null;
  runtime?.dispose();
  await sessions?.disposeAll().catch((error: unknown) => {
    logger.warn('세션 정리 중 오류', { reason: String(error) });
  });
  await store?.flush();
  await orphanRegistry?.flush();
}

// A second instance would fight over the metadata file and the CLI processes.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    logger.error('앱 초기화 실패', { reason: String(error) });
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && store) showWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Child processes must never outlive the app (spec 8.3).
  app.on('before-quit', (event) => {
    if (!sessions) return;
    event.preventDefault();
    void shutdown().finally(() => {
      sessions = null;
      app.quit();
    });
  });
}
