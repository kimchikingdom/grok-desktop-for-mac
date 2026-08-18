import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_INLINE_FILE_BYTES,
  isIgnoredDirectory,
  isSensitivePath,
  looksBinary,
  maskSecrets,
  resolveWithinRoot,
} from '@grok-desktop/security';
import type { FileContent, FileHit, MediaPreview, TreeNode } from '@grok-desktop/shared';

const MAX_ENTRIES_PER_DIRECTORY = 500;

/** One directory level at a time: the app never walks a whole home folder. */
export async function readTree(canonicalRoot: string, relPath: string): Promise<TreeNode[]> {
  const target = relPath === '' || relPath === '.' ? canonicalRoot : relPath;
  const { canonicalPath } = await resolveWithinRoot(canonicalRoot, target);

  const entries = await readdir(canonicalPath, { withFileTypes: true });
  const nodes: TreeNode[] = [];

  for (const entry of entries.slice(0, MAX_ENTRIES_PER_DIRECTORY)) {
    if (entry.isDirectory() && isIgnoredDirectory(entry.name)) continue;
    if (entry.isSymbolicLink()) {
      // Symlinks are shown but never followed by the tree walker.
      nodes.push({
        name: entry.name,
        relPath: path.join(path.relative(canonicalRoot, canonicalPath), entry.name),
        kind: 'file',
        sensitive: true,
      });
      continue;
    }

    const childRel = path.join(path.relative(canonicalRoot, canonicalPath), entry.name);
    const node: TreeNode = {
      name: entry.name,
      relPath: childRel.startsWith('..') ? entry.name : childRel,
      kind: entry.isDirectory() ? 'directory' : 'file',
      sensitive: isSensitivePath(childRel),
    };

    if (entry.isFile()) {
      const info = await stat(path.join(canonicalPath, entry.name)).catch(() => null);
      if (info) node.size = info.size;
    }
    nodes.push(node);
  }

  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readWorkspaceFile(
  canonicalRoot: string,
  relPath: string,
  maxBytes = MAX_INLINE_FILE_BYTES,
): Promise<FileContent> {
  const { canonicalPath, relPath: safeRel } = await resolveWithinRoot(canonicalRoot, relPath);
  const info = await stat(canonicalPath);
  if (!info.isFile()) throw new Error('파일이 아닙니다.');

  const sensitive = isSensitivePath(safeRel);
  if (looksBinary(safeRel)) {
    return { relPath: safeRel, text: '', truncated: false, totalBytes: info.size, sensitive, masked: false };
  }

  const handle = await open(canonicalPath, 'r');
  let buffer: Buffer;
  try {
    buffer = Buffer.alloc(Math.min(maxBytes + 1, info.size));
    await handle.read(buffer, 0, buffer.length, 0);
  } finally {
    await handle.close();
  }
  const truncated = info.size > maxBytes;
  const raw = buffer.subarray(0, maxBytes).toString('utf8');
  const text = maskSecrets(raw);

  return {
    relPath: safeRel,
    // Chat/logs mask secrets. The editor must know, or Save would write redactions.
    text,
    truncated,
    totalBytes: info.size,
    sensitive,
    masked: text !== raw,
  };
}

const MEDIA_TYPES: Record<string, { mime: string; kind: 'image' | 'video' }> = {
  '.png': { mime: 'image/png', kind: 'image' },
  '.jpg': { mime: 'image/jpeg', kind: 'image' },
  '.jpeg': { mime: 'image/jpeg', kind: 'image' },
  '.gif': { mime: 'image/gif', kind: 'image' },
  '.webp': { mime: 'image/webp', kind: 'image' },
  '.mp4': { mime: 'video/mp4', kind: 'video' },
  '.webm': { mime: 'video/webm', kind: 'video' },
};

export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
const MAX_SEARCH_VISITS = 2_000;

export function mediaKindFor(relPath: string): { mime: string; kind: 'image' | 'video' } | undefined {
  return MEDIA_TYPES[path.extname(relPath).toLowerCase()];
}

export async function searchFiles(
  canonicalRoot: string,
  query: string,
  limit = 30,
): Promise<FileHit[]> {
  const needle = query.trim().toLowerCase();

  const hits: FileHit[] = [];
  const stack = [canonicalRoot];
  let visits = 0;

  while (stack.length > 0 && hits.length < limit && visits < MAX_SEARCH_VISITS) {
    const current = stack.pop();
    if (!current) break;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      visits += 1;
      if (visits > MAX_SEARCH_VISITS) break;
      if (entry.isDirectory()) {
        if (!isIgnoredDirectory(entry.name)) stack.push(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const relPath = path.relative(canonicalRoot, path.join(current, entry.name));
      if (isSensitivePath(relPath)) continue;
      const name = entry.name;
      if (!needle || name.toLowerCase().includes(needle) || relPath.toLowerCase().includes(needle)) {
        hits.push({ relPath, name });
        if (hits.length >= limit) break;
      }
    }
  }

  return hits;
}

export async function readMedia(canonicalRoot: string, relPath: string): Promise<MediaPreview> {
  const kind = mediaKindFor(relPath);
  if (!kind) throw new Error('미리볼 수 있는 이미지나 영상이 아닙니다.');
  const { canonicalPath, relPath: safeRel } = await resolveWithinRoot(canonicalRoot, relPath);
  if (isSensitivePath(safeRel)) throw new Error('민감한 파일은 미리볼 수 없습니다.');
  const info = await stat(canonicalPath);
  if (!info.isFile()) throw new Error('파일이 아닙니다.');
  if (info.size > MAX_MEDIA_BYTES) throw new Error('파일이 너무 커서 미리볼 수 없습니다.');
  const buffer = await readFile(canonicalPath);
  return {
    relPath: safeRel,
    mimeType: kind.mime,
    dataUrl: `data:${kind.mime};base64,${buffer.toString('base64')}`,
  };
}

const INBOX_DIR = 'desktop-inbox';
const INBOX_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Clipboard / paste images land here so they stay inside the workspace. */
export async function writeInboxImage(
  canonicalRoot: string,
  mime: string,
  bytes: Buffer,
): Promise<string> {
  const ext = INBOX_TYPES[mime];
  if (!ext) throw new Error('붙여넣을 수 있는 이미지가 아닙니다.');
  if (bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) {
    throw new Error('이미지가 비어 있거나 너무 큽니다.');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const relPath = `${INBOX_DIR}/paste-${stamp}-${randomUUID().slice(0, 8)}.${ext}`;
  const { canonicalPath, relPath: safeRel } = await resolveWithinRoot(canonicalRoot, relPath);
  if (isSensitivePath(safeRel)) throw new Error('민감한 경로에는 저장할 수 없습니다.');
  await mkdir(path.dirname(canonicalPath), { recursive: true });
  const ignoreFile = path.join(path.dirname(canonicalPath), '.gitignore');
  await writeFile(ignoreFile, '*\n', { flag: 'wx' }).catch(() => undefined);
  await writeFile(canonicalPath, bytes);
  return safeRel;
}

export async function writeWorkspaceFile(
  canonicalRoot: string,
  relPath: string,
  content: string,
): Promise<string> {
  const { canonicalPath, relPath: safeRel } = await resolveWithinRoot(canonicalRoot, relPath);
  if (isSensitivePath(safeRel)) throw new Error('민감한 파일은 여기서 저장할 수 없습니다.');
  await mkdir(path.dirname(canonicalPath), { recursive: true });
  await writeFile(canonicalPath, content, 'utf8');
  return safeRel;
}

export async function resolveAttachablePaths(canonicalRoot: string, paths: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const target of paths) {
    try {
      const { relPath } = await resolveWithinRoot(canonicalRoot, target);
      if (isSensitivePath(relPath)) continue;
      resolved.push(relPath);
    } catch {
      // Outside the workspace — ignore rather than leaking the path.
    }
  }
  return [...new Set(resolved)];
}
