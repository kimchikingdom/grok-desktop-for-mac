import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrphanRegistry, isGrokProcess } from './orphans.js';

let dir: string;
const created: OrphanRegistry[] = [];

/** Registries write asynchronously; keep them so teardown can settle first. */
function makeRegistry(file: string): OrphanRegistry {
  const registry = new OrphanRegistry(file);
  created.push(registry);
  return registry;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'grok-orphans-'));
});

afterEach(async () => {
  await Promise.all(created.splice(0).map((registry) => registry.flush()));
  await rm(dir, { recursive: true, force: true });
});

describe('OrphanRegistry', () => {
  it('persists and releases pids', async () => {
    const file = path.join(dir, 'agent-pids.json');
    const registry = makeRegistry(file);
    await registry.load();

    registry.register(4242);
    registry.register(4343);
    registry.release(4242);
    await registry.flush();

    const saved = JSON.parse(await readFile(file, 'utf8')) as { pid: number }[];
    expect(saved.map((entry) => entry.pid)).toEqual([4343]);
  });

  it('starts clean when the file is missing or corrupt', async () => {
    const registry = makeRegistry(path.join(dir, 'nope.json'));
    await registry.load();
    expect(await registry.reapOrphans()).toBe(0);
  });

  it('never kills a pid that is not a grok agent', async () => {
    // A live process of our own: recorded, but not a grok agent.
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], {
      stdio: 'ignore',
      detached: true,
    });
    try {
      const registry = makeRegistry(path.join(dir, 'pids.json'));
      await registry.load();
      registry.register(child.pid as number);

      expect(await registry.reapOrphans()).toBe(0);
      expect(child.killed).toBe(false);
      expect(() => process.kill(child.pid as number, 0)).not.toThrow();
    } finally {
      try {
        process.kill(-(child.pid as number), 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  });
});

describe('isGrokProcess', () => {
  it('rejects impossible and dead pids', async () => {
    expect(await isGrokProcess(0)).toBe(false);
    expect(await isGrokProcess(1)).toBe(false);
    expect(await isGrokProcess(999_999)).toBe(false);
  });

  it('does not treat this very process as a grok agent', async () => {
    expect(await isGrokProcess(process.pid)).toBe(false);
  });
});
