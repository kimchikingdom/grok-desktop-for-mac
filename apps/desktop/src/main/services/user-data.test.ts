import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyUserData } from './user-data.js';

let scratch: string;

const setup = async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'grok-userdata-'));
  const legacy = path.join(scratch, '@grok-desktop', 'desktop');
  const current = path.join(scratch, 'Grok Desktop');
  await mkdir(path.join(legacy, 'sessions'), { recursive: true });
  await mkdir(current, { recursive: true });
  await writeFile(path.join(legacy, 'metadata.json'), '{"version":1}');
  await writeFile(path.join(legacy, 'sessions', 's1.json'), '{"id":"s1"}');
  await writeFile(path.join(legacy, 'Cookies'), 'chromium state');
  return { legacy, current };
};

afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe('migrateLegacyUserData', () => {
  it('앱이 쓴 것만 새 폴더로 옮긴다', async () => {
    const { legacy, current } = await setup();
    const moved = await migrateLegacyUserData(scratch, current);

    expect(moved).toEqual(['metadata.json', 'sessions']);
    expect(await readFile(path.join(current, 'metadata.json'), 'utf8')).toBe('{"version":1}');
    expect(await readFile(path.join(current, 'sessions', 's1.json'), 'utf8')).toBe('{"id":"s1"}');
    // Chromium's own state stays put and regenerates on its own.
    expect(await readdir(legacy)).toContain('Cookies');
  });

  it('새 폴더에 이미 있는 것은 덮어쓰지 않는다', async () => {
    const { current } = await setup();
    await writeFile(path.join(current, 'metadata.json'), '{"version":2}');

    const moved = await migrateLegacyUserData(scratch, current);

    expect(moved).toEqual(['sessions']);
    expect(await readFile(path.join(current, 'metadata.json'), 'utf8')).toBe('{"version":2}');
  });

  it('옮길 것이 없으면 조용히 끝난다', async () => {
    scratch = await mkdtemp(path.join(os.tmpdir(), 'grok-userdata-'));
    const current = path.join(scratch, 'Grok Desktop');
    await mkdir(current, { recursive: true });
    expect(await migrateLegacyUserData(scratch, current)).toEqual([]);
  });

  it('예전 경로를 그대로 쓰고 있으면 아무것도 하지 않는다', async () => {
    const { legacy } = await setup();
    expect(await migrateLegacyUserData(scratch, legacy)).toEqual([]);
    expect(await readFile(path.join(legacy, 'metadata.json'), 'utf8')).toBe('{"version":1}');
  });
})
