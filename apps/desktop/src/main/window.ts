import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { isSafeExternalUrl } from '@grok-desktop/security';
import { logger } from './services/logger.js';

/**
 * Only honoured while running from source. In a packaged app this variable is
 * attacker-supplied input: setting it would relax the CSP, switch DevTools on,
 * and load a remote page with the preload bridge attached.
 */
const DEV_SERVER_URL = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;

function appEntryPath(): string {
  return path.join(__dirname, '../renderer/index.html');
}

/** The single page this window may show, as the URL Chromium reports for it. */
function appEntryUrl(): string {
  return pathToFileURL(appEntryPath()).toString();
}

/** Matches --bg in the renderer stylesheet for each theme. */
const WINDOW_BACKGROUND = { dark: '#0d0d0d', light: '#f7f7f8' } as const;

function resolveAppIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, '../../build/icon.png'),
    path.join(process.resourcesPath, 'icon.png'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/** Dock uses the bundle icns when packaged; this covers `pnpm dev`. */
export function applyDockIcon(): void {
  const icon = resolveAppIcon();
  if (icon && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon);
  }
}

function backgroundForSystem(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light;
}

/**
 * `style-src` needs unsafe-inline because Vite injects styles as <style> tags.
 * In dev only, `script-src` also needs it for the React Fast Refresh preamble;
 * the production policy stays `'self'` with no inline execution.
 */
function contentSecurityPolicy(): string {
  const connect = DEV_SERVER_URL ? `'self' ${DEV_SERVER_URL} ws://localhost:* http://localhost:*` : "'self'";
  const script = DEV_SERVER_URL ? `'self' 'unsafe-inline' ${DEV_SERVER_URL}` : "'self'";
  return [
    "default-src 'none'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "media-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    // Chromium drops a bracketed IPv6 host from a source list, so [::1] cannot
    // be named here; the preview pane sends those URLs to the browser instead.
    "frame-src http://127.0.0.1:* http://localhost:*",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    // Follows the OS appearance, so the window never flashes the wrong theme.
    backgroundColor: backgroundForSystem(),
    icon: resolveAppIcon(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      spellcheck: false,
      devTools: Boolean(DEV_SERVER_URL),
    },
  });

  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });

  // The app is a single window: nothing may navigate it or spawn siblings.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    } else {
      logger.security('허용되지 않은 새 창 요청을 차단했습니다.', { url });
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    // Any file:// used to pass, so dropping an .html file on the window would
    // navigate to it — and that page would inherit the preload bridge. Only the
    // one page this window was built to show is allowed.
    const allowed = DEV_SERVER_URL ? url.startsWith(DEV_SERVER_URL) : url === appEntryUrl();
    if (!allowed) {
      event.preventDefault();
      logger.security('허용되지 않은 페이지 이동을 차단했습니다.', { url });
    }
  });

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
    logger.security('webview 부착 시도를 차단했습니다.');
  });

  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    if (permission === 'clipboard-sanitized-write') {
      callback(true);
      return;
    }
    logger.security('브라우저 권한 요청을 거부했습니다.', { permission });
    callback(false);
  });

  // Renderer diagnostics go through the masking logger, never straight to disk.
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      logger.warn(`[renderer] ${details.message}`, { source: details.sourceId, line: details.lineNumber });
    }
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.error('렌더러를 불러오지 못했습니다.', { errorCode, errorDescription, validatedURL });
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('렌더러 프로세스가 종료되었습니다.', { reason: details.reason });
  });

  // The renderer picks up the switch through prefers-color-scheme on its own;
  // this keeps the native chrome behind it in step.
  const onThemeChange = () => {
    if (!window.isDestroyed()) window.setBackgroundColor(backgroundForSystem());
  };
  nativeTheme.on('updated', onThemeChange);
  window.on('closed', () => nativeTheme.off('updated', onThemeChange));

  window.once('ready-to-show', () => window.show());

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(appEntryPath());
  }

  return window;
}
