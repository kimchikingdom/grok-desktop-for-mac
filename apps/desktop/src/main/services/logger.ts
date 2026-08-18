import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { maskSecrets } from '@grok-desktop/security';

type Level = 'debug' | 'info' | 'warn' | 'error' | 'security';

let logDirectory: string | null = null;
let queue: Promise<void> = Promise.resolve();

export function configureLogger(directory: string): void {
  logDirectory = directory;
}

/**
 * Everything written here passes through the secret masker first (spec 8.3),
 * so diagnostics can be exported without leaking tokens.
 */
function write(level: Level, message: string, context?: Record<string, unknown>): void {
  const masked = maskSecrets(message);
  const maskedContext = context ? maskSecrets(JSON.stringify(context)) : '';
  const line = `${new Date().toISOString()} [${level}] ${masked}${maskedContext ? ` ${maskedContext}` : ''}`;

  if (level === 'error' || level === 'security') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  if (!logDirectory) return;
  const directory = logDirectory;
  queue = queue
    .then(async () => {
      await mkdir(directory, { recursive: true });
      await appendFile(path.join(directory, 'grok-desktop.log'), `${line}\n`, { encoding: 'utf8', mode: 0o600 });
    })
    .catch(() => {
      // Logging must never break the app.
    });
}

export function logFilePath(): string | null {
  return logDirectory ? path.join(logDirectory, 'grok-desktop.log') : null;
}

export async function readDiagnosticLog(maxBytes = 200_000): Promise<string> {
  const file = logFilePath();
  if (!file) return '';
  const raw = await readFile(file, 'utf8').catch(() => '');
  return raw.length > maxBytes ? raw.slice(-maxBytes) : raw;
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context),
  /** Denied path escapes, rejected IPC, blocked URLs — always recorded. */
  security: (message: string, context?: Record<string, unknown>) => write('security', message, context),
};
