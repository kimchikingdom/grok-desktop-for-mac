import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Before the app declared a `productName`, Electron named the user-data folder
 * after the package: `@grok-desktop/desktop`. Sessions, approvals and the UI
 * cache all live there, so the rename has to carry them over or the user opens
 * the app to an empty history.
 */
const LEGACY_SEGMENTS = ['@grok-desktop', 'desktop'];

/** Only what this app writes. Chromium's own caches are left to regenerate. */
const OWNED_ENTRIES = ['metadata.json', 'agent-pids.json', 'sessions', 'overlays', 'logs'];

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves the app's own files out of the legacy folder, once. Anything already
 * present in the new location wins — this never overwrites newer data, and it
 * leaves the legacy folder in place so a mistake stays recoverable.
 */
export async function migrateLegacyUserData(appDataDir: string, userDataDir: string): Promise<string[]> {
  const legacy = path.join(appDataDir, ...LEGACY_SEGMENTS);
  if (path.resolve(legacy) === path.resolve(userDataDir)) return [];
  if (!(await exists(legacy))) return [];

  const moved: string[] = [];
  for (const entry of OWNED_ENTRIES) {
    const from = path.join(legacy, entry);
    const to = path.join(userDataDir, entry);
    if (!(await exists(from)) || (await exists(to))) continue;
    try {
      await mkdir(path.dirname(to), { recursive: true });
      await rename(from, to);
      moved.push(entry);
    } catch {
      // A cross-device move or a locked file: leave it and keep going. The app
      // starts fresh for that entry rather than failing to start at all.
    }
  }
  return moved;
}
