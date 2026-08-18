export const PINNED_SESSIONS_KEY = 'grok-desktop.pinned-sessions';
export const RECENT_FILES_KEY = 'grok-desktop.recent-files';
export const ISOLATION_KEY = 'grok-desktop.last-isolation';
export const VIEW_MODE_KEY = 'grok-desktop.view-mode';

export type IsolationPref = 'none' | 'worktree';
export type ViewModePref = 'normal' | 'verbose' | 'summary';

export function readStringList(raw: string | null, max = 40): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, max);
  } catch {
    return [];
  }
}

export function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [id, ...list];
}

export function rememberPath(list: string[], relPath: string, max = 8): string[] {
  if (!relPath) return list;
  return [relPath, ...list.filter((item) => item !== relPath)].slice(0, max);
}

export function readRecentMap(raw: string | null): Record<string, string[]> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [workspaceId, value] of Object.entries(parsed)) {
      if (!workspaceId || !Array.isArray(value)) continue;
      out[workspaceId] = value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 8);
    }
    return out;
  } catch {
    return {};
  }
}

export function loadPrefs(): { pinnedIds: string[]; lastIsolation: IsolationPref; viewMode: ViewModePref } {
  if (typeof localStorage === 'undefined') {
    return { pinnedIds: [], lastIsolation: 'none', viewMode: 'normal' };
  }
  const isolation = localStorage.getItem(ISOLATION_KEY);
  const viewMode = localStorage.getItem(VIEW_MODE_KEY);
  return {
    pinnedIds: readStringList(localStorage.getItem(PINNED_SESSIONS_KEY)),
    lastIsolation: isolation === 'worktree' ? 'worktree' : 'none',
    viewMode: viewMode === 'verbose' || viewMode === 'summary' ? viewMode : 'normal',
  };
}

export function saveIsolation(value: IsolationPref): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(ISOLATION_KEY, value);
}

export function saveViewMode(value: ViewModePref): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(VIEW_MODE_KEY, value);
}

export function loadRecentFiles(workspaceId: string): string[] {
  if (typeof localStorage === 'undefined' || !workspaceId) return [];
  return readRecentMap(localStorage.getItem(RECENT_FILES_KEY))[workspaceId] ?? [];
}

export function savePinnedIds(ids: string[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(ids));
}

export function saveRecentFiles(workspaceId: string, paths: string[]): void {
  if (typeof localStorage === 'undefined' || !workspaceId) return;
  const all = readRecentMap(localStorage.getItem(RECENT_FILES_KEY));
  all[workspaceId] = paths.slice(0, 8);
  localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(all));
}
