import { Menu, Tray, app, nativeImage } from 'electron';
import type { SessionStatus } from '@grok-desktop/shared';
import { logger } from './services/logger.js';
import { TRAY_ICON_1X, TRAY_ICON_2X } from './tray-icon.js';

export type TrayState = {
  status: SessionStatus;
  workspaceName?: string;
  /** Number of approval cards waiting for the user right now. */
  pendingApprovals: number;
  running: boolean;
};

export type TrayActions = {
  showWindow: () => void;
  cancelRun: () => void;
  quit: () => void;
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: '대기 중',
  starting: '시작하는 중',
  running: '작업 중',
  'waiting-approval': '승인 대기 중',
  failed: '오류',
  closed: '세션 없음',
};

function buildIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_1X);
  icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_2X });
  // Template images follow the macOS menu bar's light/dark appearance.
  icon.setTemplateImage(true);
  return icon;
}

/**
 * Menu-bar presence so the app is reachable and its state readable without
 * switching windows. On macOS it also surfaces "승인 대기" as text, because a
 * blocked approval is the one state the user must notice immediately.
 */
export class TrayController {
  #tray: Tray | null = null;
  #state: TrayState = { status: 'closed', pendingApprovals: 0, running: false };

  constructor(private readonly actions: TrayActions) {}

  start(): void {
    if (this.#tray) return;
    try {
      this.#tray = new Tray(buildIcon());
      this.#tray.on('click', () => this.actions.showWindow());
      this.render();
    } catch (error) {
      // A missing menu bar (headless CI, some Linux setups) must not be fatal.
      logger.warn('트레이 아이콘을 만들지 못했습니다.', { reason: String(error) });
      this.#tray = null;
    }
  }

  update(patch: Partial<TrayState>): void {
    const next = { ...this.#state, ...patch };
    if (
      next.status === this.#state.status &&
      next.workspaceName === this.#state.workspaceName &&
      next.pendingApprovals === this.#state.pendingApprovals &&
      next.running === this.#state.running
    ) {
      return;
    }
    this.#state = next;
    this.render();
  }

  render(): void {
    const tray = this.#tray;
    if (!tray) return;

    const { status, workspaceName, pendingApprovals, running } = this.#state;
    const statusLabel = pendingApprovals > 0 ? `승인 대기 ${pendingApprovals}건` : STATUS_LABEL[status];

    tray.setToolTip(workspaceName ? `Grok Desktop — ${workspaceName} (${statusLabel})` : 'Grok Desktop');
    if (process.platform === 'darwin') {
      tray.setTitle(pendingApprovals > 0 ? ` 승인 ${pendingApprovals}` : '');
    }

    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: workspaceName ? `프로젝트: ${workspaceName}` : '열린 프로젝트 없음', enabled: false },
        { label: `상태: ${statusLabel}`, enabled: false },
        { type: 'separator' },
        { label: 'Grok Desktop 열기', click: () => this.actions.showWindow() },
        {
          label: pendingApprovals > 0 ? '승인 대기 취소' : '실행 중단',
          enabled: running || pendingApprovals > 0 || status === 'waiting-approval',
          click: () => this.actions.cancelRun(),
        },
        { type: 'separator' },
        { label: '종료', click: () => this.actions.quit() },
      ]),
    );
  }

  dispose(): void {
    this.#tray?.destroy();
    this.#tray = null;
  }
}

/** Keeps the dock badge in step with pending approvals on macOS. */
export function setDockBadge(pendingApprovals: number): void {
  if (process.platform !== 'darwin' || !app.dock) return;
  app.dock.setBadge(pendingApprovals > 0 ? String(pendingApprovals) : '');
}
