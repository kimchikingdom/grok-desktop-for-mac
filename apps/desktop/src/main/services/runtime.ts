import { spawn } from 'node:child_process';
import { detectAuthStatus, detectRuntime } from '@grok-desktop/acp-client';
import { assertSafeExternalUrl, maskSecrets, sanitizeEnvironment } from '@grok-desktop/security';
import {
  GROK_DOCS_URL,
  GROK_INSTALL_COMMAND,
  GROK_INSTALL_COMMAND_WINDOWS,
  type AuthStatus,
  type InstallInstructions,
  type RuntimeStatus,
} from '@grok-desktop/shared';
import { logger } from './logger.js';

const LOGIN_OUTPUT_WINDOW_MS = 20_000;
const LOGIN_POLL_INTERVAL_MS = 3_000;
const LOGIN_POLL_TIMEOUT_MS = 5 * 60_000;

/**
 * Owns everything that talks to the CLI outside of a session: detection,
 * version, and the browser login. Credentials never pass through this process —
 * `grok login` writes them into the CLI's own store.
 */
export class RuntimeService {
  #status: RuntimeStatus | null = null;
  #loginChild: ReturnType<typeof spawn> | null = null;
  #pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly onStatusChange: (status: RuntimeStatus) => void,
    private readonly openExternal?: (url: string) => Promise<void>,
  ) {}

  async refresh(): Promise<RuntimeStatus> {
    const status = await detectRuntime();
    const changed = JSON.stringify(status) !== JSON.stringify(this.#status);
    this.#status = status;
    if (changed) this.onStatusChange(status);
    return status;
  }

  async getStatus(): Promise<RuntimeStatus> {
    return this.#status ?? this.refresh();
  }

  async getAuthStatus(): Promise<AuthStatus> {
    return detectAuthStatus();
  }

  installInstructions(): InstallInstructions {
    return {
      command: process.platform === 'win32' ? GROK_INSTALL_COMMAND_WINDOWS : GROK_INSTALL_COMMAND,
      docsUrl: GROK_DOCS_URL,
      note: '앱은 설치를 대신 실행하지 않습니다. 위 명령을 터미널에서 직접 실행한 뒤 다시 확인을 눌러 주세요.',
    };
  }

  /**
   * Starts `grok login --device-auth` and surfaces the verification URL and code
   * so the user completes the flow in their own browser.
   */
  async startLogin(): Promise<AuthStatus> {
    const status = await this.getStatus();
    if (!status.binaryPath) {
      throw new Error('Grok CLI가 설치되어 있지 않습니다.');
    }
    if (this.#loginChild) {
      throw new Error('이미 로그인 절차가 진행 중입니다.');
    }

    const child = spawn(status.binaryPath, ['login', '--device-auth'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: sanitizeEnvironment(process.env),
      detached: process.platform !== 'win32',
    });
    this.#loginChild = child;

    let output = '';
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8');
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    child.on('exit', () => {
      this.#loginChild = null;
      void this.refresh();
    });

    const details = await new Promise<{ url?: string; code?: string }>((resolve) => {
      const timer = setTimeout(() => resolve(parseLoginOutput(output)), LOGIN_OUTPUT_WINDOW_MS);
      const check = setInterval(() => {
        const parsed = parseLoginOutput(output);
        if (parsed.url) {
          clearInterval(check);
          clearTimeout(timer);
          resolve(parsed);
        }
      }, 500);
      check.unref?.();
      timer.unref?.();
    });

    this.#startAuthPolling();

    if (!details.url) {
      logger.warn('로그인 출력에서 인증 URL을 찾지 못했습니다.', { output: maskSecrets(output).slice(0, 500) });
      return {
        authenticated: false,
        method: 'oauth',
        detail:
          'grok login을 실행했지만 인증 URL을 감지하지 못했습니다. 터미널에서 grok login을 직접 실행해 주세요.',
      };
    }

    // Only ever hand an allow-listed https URL to the OS browser.
    let safeUrl: string;
    try {
      safeUrl = assertSafeExternalUrl(details.url).toString();
    } catch (error) {
      logger.security('로그인 URL이 허용 목록에 없어 열지 않았습니다.', { url: details.url });
      throw error;
    }

    let opened = false;
    if (this.openExternal) {
      try {
        await this.openExternal(safeUrl);
        opened = true;
      } catch (error) {
        logger.warn('로그인 페이지를 열지 못했습니다.', { reason: String(error) });
      }
    }

    return {
      authenticated: false,
      method: 'oauth',
      loginUrl: safeUrl,
      loginCode: details.code,
      detail: details.code
        ? opened
          ? `브라우저에서 코드 ${details.code} 를 입력해 로그인을 완료해 주세요.`
          : `브라우저에서 ${safeUrl} 를 열고 코드 ${details.code} 를 입력해 로그인을 완료해 주세요.`
        : opened
          ? '브라우저에서 로그인을 완료해 주세요.'
          : `브라우저에서 ${safeUrl} 를 열어 로그인을 완료해 주세요.`,
    };
  }

  #startAuthPolling(): void {
    if (this.#pollTimer) return;
    const startedAt = Date.now();
    this.#pollTimer = setInterval(() => {
      void (async () => {
        const status = await this.refresh();
        if (status.state === 'ready' || Date.now() - startedAt > LOGIN_POLL_TIMEOUT_MS) {
          this.#stopAuthPolling();
          if (status.state !== 'ready') this.#killLoginChild();
        }
      })();
    }, LOGIN_POLL_INTERVAL_MS);
    this.#pollTimer.unref?.();
  }

  #stopAuthPolling(): void {
    if (!this.#pollTimer) return;
    clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }

  #killLoginChild(): void {
    const child = this.#loginChild;
    this.#loginChild = null;
    if (!child?.pid) return;
    try {
      if (process.platform === 'win32') child.kill();
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill();
    }
  }

  dispose(): void {
    this.#stopAuthPolling();
    this.#killLoginChild();
  }
}

export function parseLoginOutput(output: string): { url?: string; code?: string } {
  const urlMatch = /https:\/\/[^\s"'<>]+/.exec(output);
  const codeMatch = /\b([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b/.exec(output);
  const result: { url?: string; code?: string } = {};
  if (urlMatch?.[0]) result.url = urlMatch[0].replace(/[.,)]+$/, '');
  if (codeMatch?.[1]) result.code = codeMatch[1];
  return result;
}
