import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { sanitizeEnvironment } from '@grok-desktop/security';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

type Entry = { pid: number; startedAt: string };

/**
 * Agents are spawned into their own process group so a cancel can take down the
 * whole tree. The flip side is that a hard kill of the app (SIGKILL, a crash)
 * leaves them running. Recording the pids lets the next launch clean up exactly
 * the processes this app started — never a `grok` the user runs themselves.
 */
export class OrphanRegistry {
  #entries: Entry[] = [];
  #queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      this.#entries = Array.isArray(parsed)
        ? parsed.filter((entry): entry is Entry => typeof (entry as Entry)?.pid === 'number')
        : [];
    } catch {
      this.#entries = [];
    }
  }

  register(pid: number): void {
    this.#entries.push({ pid, startedAt: new Date().toISOString() });
    this.#persist();
  }

  release(pid: number): void {
    this.#entries = this.#entries.filter((entry) => entry.pid !== pid);
    this.#persist();
  }

  /** Kill leftovers from a previous run, after confirming they are still grok. */
  async reapOrphans(): Promise<number> {
    const survivors: Entry[] = [];
    let reaped = 0;

    for (const entry of this.#entries) {
      if (!(await isGrokProcess(entry.pid))) continue;
      try {
        process.kill(-entry.pid, 'SIGTERM');
        reaped += 1;
        logger.info('이전 실행에서 남은 Grok 에이전트를 정리했습니다.', { pid: entry.pid });
      } catch {
        survivors.push(entry);
      }
    }

    this.#entries = survivors;
    this.#persist();
    return reaped;
  }

  #persist(): void {
    const snapshot = JSON.stringify(this.#entries);
    this.#queue = this.#queue
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        const temp = `${this.filePath}.tmp`;
        await writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600 });
        await rename(temp, this.filePath);
      })
      .catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.#queue;
  }
}

/**
 * A pid alone is not proof: the number may have been recycled. Only a live
 * process whose command line is the Grok agent is treated as ours.
 */
export async function isGrokProcess(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'wmic',
        ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/value'],
        { timeout: 3_000, env: sanitizeEnvironment(process.env) },
      );
      const command = stdout.trim();
      return /grok/i.test(command) && /agent/i.test(command) && /stdio/i.test(command);
    }
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)], {
      timeout: 3_000,
      env: sanitizeEnvironment(process.env),
    });
    const command = stdout.trim();
    // `agent stdio` is the only shape this app spawns. Without the last check a
    // recycled PID belonging to the user's own interactive `grok` would be
    // killed as if it were our leftover.
    return command.includes('grok') && command.includes('agent') && command.includes('stdio');
  } catch {
    return false;
  }
}
