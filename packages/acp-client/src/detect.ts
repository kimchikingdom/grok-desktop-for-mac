import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  GROK_DOCS_URL,
  GROK_INSTALL_COMMAND,
  GROK_INSTALL_COMMAND_WINDOWS,
  type AuthStatus,
  type RuntimeStatus,
} from '@grok-desktop/shared';
import { sanitizeEnvironment } from '@grok-desktop/security';

const execFileAsync = promisify(execFile);

export type DetectOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** Overrides discovery entirely; used by tests and by a user-set path. */
  explicitPath?: string;
};

const BINARY_NAME = process.platform === 'win32' ? 'grok.exe' : 'grok';

function candidateDirectories(home: string, env: NodeJS.ProcessEnv): string[] {
  const fromPath = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const wellKnown =
    process.platform === 'win32'
      ? [path.join(home, 'AppData', 'Local', 'Programs', 'grok'), path.join(home, '.grok', 'bin')]
      : [
          path.join(home, '.grok', 'bin'),
          path.join(home, '.local', 'bin'),
          path.join(home, 'bin'),
          '/usr/local/bin',
          '/opt/homebrew/bin',
        ];
  return [...fromPath, ...wellKnown];
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findGrokBinary(options: DetectOptions = {}): Promise<string | null> {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? os.homedir();

  if (options.explicitPath) {
    return (await isExecutable(options.explicitPath)) ? options.explicitPath : null;
  }
  if (env.GROK_DESKTOP_CLI_PATH && (await isExecutable(env.GROK_DESKTOP_CLI_PATH))) {
    return env.GROK_DESKTOP_CLI_PATH;
  }

  for (const directory of candidateDirectories(home, env)) {
    const candidate = path.join(directory, BINARY_NAME);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

export async function readGrokVersion(binaryPath: string, timeoutMs = 8_000): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binaryPath, ['version'], {
      timeout: timeoutMs,
      env: sanitizeEnvironment(process.env),
      maxBuffer: 1024 * 1024,
    });
    const firstLine = stdout.split('\n').find((line) => line.trim().length > 0) ?? '';
    const semver = /\d+\.\d+\.\d+[\w.+-]*/.exec(firstLine);
    return semver?.[0] ?? (firstLine.trim() || null);
  } catch {
    return null;
  }
}

/**
 * There is no documented machine-readable auth probe, so this is a heuristic:
 * an explicit API key wins, otherwise we look for the CLI's cached credential
 * files. A wrong guess is corrected the moment a session reports an auth error.
 */
export async function detectAuthStatus(options: DetectOptions = {}): Promise<AuthStatus> {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? os.homedir();

  if (env.XAI_API_KEY) {
    return { authenticated: true, method: 'api-key', detail: 'XAI_API_KEY 환경변수를 사용합니다.' };
  }

  const grokHome = env.GROK_HOME ?? path.join(home, '.grok');
  const credentialFiles = [
    path.join(grokHome, 'auth.json'),
    path.join(grokHome, 'credentials.json'),
    path.join(grokHome, 'session.json'),
    path.join(grokHome, 'tokens.json'),
    path.join(home, '.config', 'grok', 'auth.json'),
  ];

  for (const file of credentialFiles) {
    try {
      await access(file, constants.R_OK);
      return { authenticated: true, method: 'oauth', detail: 'Grok CLI에 저장된 로그인 정보를 찾았습니다.' };
    } catch {
      continue;
    }
  }

  return {
    authenticated: false,
    method: 'unknown',
    detail: 'Grok CLI 로그인 정보를 찾지 못했습니다. 브라우저 로그인이 필요합니다.',
  };
}

export async function detectRuntime(options: DetectOptions = {}): Promise<RuntimeStatus> {
  const installCommand =
    process.platform === 'win32' ? GROK_INSTALL_COMMAND_WINDOWS : GROK_INSTALL_COMMAND;
  const base = { installCommand, docsUrl: GROK_DOCS_URL };

  const binaryPath = await findGrokBinary(options);
  if (!binaryPath) {
    return {
      ...base,
      state: 'not-installed',
      detail: 'PATH와 기본 설치 경로에서 grok 실행 파일을 찾지 못했습니다.',
    };
  }

  const version = await readGrokVersion(binaryPath);
  if (!version) {
    return {
      ...base,
      state: 'failed',
      binaryPath,
      detail: 'grok version 명령이 응답하지 않았습니다. 설치가 손상되었을 수 있습니다.',
    };
  }

  const auth = await detectAuthStatus(options);
  return {
    ...base,
    state: auth.authenticated ? 'ready' : 'unauthenticated',
    binaryPath,
    version,
    detail: auth.detail,
  };
}
