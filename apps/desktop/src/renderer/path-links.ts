/** Relative workspace paths the chat can open. Absolute and URL paths stay out. */
export function looksLikeWorkspacePath(value: string): string | null {
  return parseWorkspaceRef(value)?.relPath ?? null;
}

export function parseWorkspaceRef(value: string): { relPath: string; line?: number } | null {
  const trimmed = value.trim().replace(/^<|>$/g, '').replace(/^`+|`+$/g, '');
  if (!trimmed || trimmed.includes('://') || trimmed.startsWith('/') || trimmed.startsWith('~')) {
    return null;
  }
  const lineMatch = trimmed.match(/(?::|#L)(\d+)(?::\d+)?$/);
  const pathPart = (lineMatch ? trimmed.slice(0, lineMatch.index) : trimmed).replace(/^\.\//, '');
  if (!pathPart || pathPart.includes('..')) return null;
  if (!/^(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(pathPart)) return null;
  if (/^(?:e\.g|i\.e|vs|etc)\.[A-Za-z]+$/i.test(pathPart)) return null;
  const line = lineMatch ? Number(lineMatch[1]) : undefined;
  return { relPath: pathPart, line: line && line > 0 ? line : undefined };
}

export function splitLinkableText(text: string): { value: string; relPath?: string; line?: number }[] {
  const parts: { value: string; relPath?: string; line?: number }[] = [];
  const pattern = /`([^`]+)`|((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,7}(?::\d+(?::\d+)?|#L\d+)?)/g;
  let cursor = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > cursor) parts.push({ value: text.slice(cursor, match.index) });
    const raw = match[1] ?? match[2] ?? '';
    const parsed = parseWorkspaceRef(raw);
    parts.push(parsed ? { value: match[0], relPath: parsed.relPath, line: parsed.line } : { value: match[0] });
    cursor = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (cursor < text.length) parts.push({ value: text.slice(cursor) });
  return parts.length > 0 ? parts : [{ value: text }];
}

export function parentDir(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const slash = normalized.lastIndexOf('/');
  return slash <= 0 ? '' : normalized.slice(0, slash);
}

export function ancestorDirs(relPath: string): string[] {
  const dirs: string[] = [];
  let current = parentDir(relPath);
  while (current) {
    dirs.unshift(current);
    current = parentDir(current);
  }
  return dirs;
}

export function pathBreadcrumb(relPath: string): { label: string; relPath: string; file: boolean }[] {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.map((label, index) => ({
    label,
    relPath: parts.slice(0, index + 1).join('/'),
    file: index === parts.length - 1,
  }));
}

export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(then).toLocaleDateString();
}

