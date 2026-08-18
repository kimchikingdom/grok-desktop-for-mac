import { readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSessionUpdate } from '@grok-desktop/acp-client';
import { maskSecrets } from '@grok-desktop/security';
import {
  applyTranscriptEvent,
  titleFromPrompt,
  upsertChange,
  type CachedChatItem,
  type FileChangeSummary,
  type ToolKind,
} from '@grok-desktop/shared';
import { logger } from './logger.js';

export type CliSessionKind = 'main' | 'subagent';

export type CliSessionIndex = {
  id: string;
  cwd: string;
  title: string;
  preview: string;
  /** Title + summaries + user/agent snippets, used for list search. */
  searchText: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  kind: CliSessionKind;
  directory: string;
};

export function grokHome(env: NodeJS.ProcessEnv = process.env, homeDir = os.homedir()): string {
  return env.GROK_HOME?.trim() || path.join(homeDir, '.grok');
}

export function encodeWorkspaceKey(canonicalRoot: string): string {
  return encodeURIComponent(canonicalRoot);
}

export function sessionsRoot(home = grokHome()): string {
  return path.join(home, 'sessions');
}

type SummaryFile = {
  info?: { id?: string; cwd?: string };
  session_summary?: string;
  generated_title?: string;
  created_at?: string;
  updated_at?: string;
  last_active_at?: string;
  last_turn_summary?: string;
  num_messages?: number;
  current_model_id?: string;
  session_kind?: string;
};

function asIso(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function displayTitle(summary: SummaryFile): string {
  const raw = summary.generated_title?.trim() || summary.session_summary?.trim() || '';
  if (!raw) return '이전 대화';
  return titleFromPrompt(stripComposerDecorations(raw));
}

/** Mode/instruction prefixes the app injects should not become the session title. */
export function stripComposerDecorations(text: string): string {
  return text
    .replace(/^프로젝트 지시사항:\n[\s\S]*?\n\n/, '')
    .replace(/^답하기 전에 추론 과정을 먼저 정리하라\.\n+/, '')
    .replace(/^\[모드: [^\]]+\][^\n]*\n\n/, '')
    .replace(/^\/(?:imagine-video|imagine|deep-research)\s+/i, '');
}

export async function listCliSessions(
  canonicalRoot: string,
  options: { includeSubagents?: boolean; grokHomeDir?: string } = {},
): Promise<CliSessionIndex[]> {
  const root = sessionsRoot(options.grokHomeDir ?? grokHome());
  const groups = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found: CliSessionIndex[] = [];

  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const groupPath = path.join(root, group.name);
    const groupCwd = await resolveGroupCwd(groupPath, group.name);
    if (groupCwd && path.resolve(groupCwd) !== path.resolve(canonicalRoot)) continue;

    const children = await readdir(groupPath, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const directory = path.join(groupPath, child.name);
      const summary = await readSummary(directory);
      if (!summary?.info?.id) continue;
      const kind: CliSessionKind = summary.session_kind === 'subagent' ? 'subagent' : 'main';
      if (kind === 'subagent' && !options.includeSubagents) continue;
      const cwd = summary.info.cwd || groupCwd || canonicalRoot;
      if (path.resolve(cwd) !== path.resolve(canonicalRoot)) continue;
      const updatedAt = asIso(summary.last_active_at || summary.updated_at, new Date().toISOString());
      const title = displayTitle(summary);
      const preview = [summary.last_turn_summary, summary.session_summary]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
        .join(' · ')
        .slice(0, 240);
      found.push({
        id: summary.info.id,
        cwd,
        title,
        preview,
        searchText: await collectSearchText(directory, title, preview),
        model: summary.current_model_id,
        createdAt: asIso(summary.created_at, updatedAt),
        updatedAt,
        messageCount: summary.num_messages ?? 0,
        kind,
        directory,
      });
    }
  }

  return found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function findCliSession(
  canonicalRoot: string,
  grokSessionId: string,
  grokHomeDir?: string,
): Promise<CliSessionIndex | undefined> {
  const listed = await listCliSessions(canonicalRoot, { includeSubagents: true, grokHomeDir });
  return listed.find((entry) => entry.id === grokSessionId);
}

export async function renameCliSessionTitle(
  canonicalRoot: string,
  grokSessionId: string,
  title: string,
  grokHomeDir?: string,
): Promise<void> {
  const found = await findCliSession(canonicalRoot, grokSessionId, grokHomeDir);
  if (!found) return;
  const summary = await readSummary(found.directory);
  if (!summary) return;
  summary.generated_title = title.slice(0, 200);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(found.directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

export async function replayCliTranscript(
  directory: string,
  options: { maxItems?: number } = {},
): Promise<{ items: CachedChatItem[]; changes: FileChangeSummary[] }> {
  const maxItems = options.maxItems ?? 2_000;
  const file = path.join(directory, 'updates.jsonl');
  const raw = await readFile(file, 'utf8').catch(() => '');
  if (!raw) return { items: [], changes: [] };

  let items: CachedChatItem[] = [];
  let changes: FileChangeSummary[] = [];
  let userText = '';
  let answerText = '';
  let thoughtText = '';
  let answerId = '';
  let thoughtId = '';
  let counter = 0;
  const nextId = (prefix: string) => `cli-${prefix}-${(counter += 1)}`;

  const flushUser = (at: string) => {
    const text = stripComposerDecorations(userText).trim();
    userText = '';
    if (text) items.push({ kind: 'user', id: nextId('user'), text: maskSecrets(text), at });
  };
  const flushAnswer = () => {
    if (!answerText) return;
    items.push({
      kind: 'message',
      id: answerId || nextId('ans'),
      channel: 'answer',
      text: maskSecrets(answerText),
    });
    answerText = '';
    answerId = '';
  };
  const flushThought = () => {
    if (!thoughtText) return;
    items.push({
      kind: 'message',
      id: thoughtId || nextId('th'),
      channel: 'thought',
      text: maskSecrets(thoughtText),
    });
    thoughtText = '';
    thoughtId = '';
  };

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const record = parsed as {
      timestamp?: number;
      params?: { update?: Record<string, unknown> };
    };
    const update = record.params?.update;
    if (!update) continue;
    const at =
      typeof record.timestamp === 'number' ? new Date(record.timestamp * 1000).toISOString() : new Date().toISOString();
    const normalised = parseSessionUpdate(update);

    switch (normalised.kind) {
      case 'user-message':
        flushAnswer();
        flushThought();
        userText += normalised.text;
        break;
      case 'agent-message':
        flushUser(at);
        if (!answerId) answerId = nextId('ans');
        answerText += normalised.text;
        break;
      case 'agent-thought':
        flushUser(at);
        if (!thoughtId) thoughtId = nextId('th');
        thoughtText += normalised.text;
        break;
      case 'tool-call': {
        flushUser(at);
        flushAnswer();
        flushThought();
        const existing = items.find((item) => item.kind === 'tool' && item.id === normalised.call.toolCallId);
        const previous = existing?.kind === 'tool' ? existing.call : undefined;
        const output = toolOutputFromCall(normalised.call) ?? previous?.output;
        items = applyTranscriptEvent(items, {
          type: 'tool-call',
          sessionId: 'cli',
          call: {
            id: normalised.call.toolCallId,
            kind: normalised.call.kind ? asToolKind(normalised.call.kind) : (previous?.kind ?? 'other'),
            title: normalised.call.title || previous?.title || '도구',
            status: mapReplayStatus(normalised.call.status) ?? previous?.status ?? 'in-progress',
            locations:
              (normalised.call.locations ?? []).length > 0
                ? (normalised.call.locations ?? []).map((location) => ({
                    path: location.path,
                    insideWorkspace: true,
                    line: location.line,
                  }))
                : (previous?.locations ?? []),
            output: output ? maskSecrets(output) : undefined,
            startedAt: previous?.startedAt ?? at,
            endedAt:
              mapReplayStatus(normalised.call.status) === 'completed' || mapReplayStatus(normalised.call.status) === 'failed'
                ? at
                : previous?.endedAt,
          },
        });
        for (const change of diffsFromCall(normalised.call)) {
          changes = upsertChange(changes, change);
        }
        break;
      }
      case 'plan':
        flushUser(at);
        items = applyTranscriptEvent(items, {
          type: 'plan',
          sessionId: 'cli',
          entries: normalised.entries.map((entry) => ({
            content: entry.content,
            status: entry.status === 'in_progress' ? 'in-progress' : entry.status,
            priority: entry.priority,
          })),
        });
        break;
      case 'subagent':
        flushUser(at);
        items = applyTranscriptEvent(items, {
          type: 'subagent',
          sessionId: 'cli',
          id: normalised.id,
          title: normalised.title,
          status: normalised.phase === 'finished' ? 'completed' : 'running',
          detail: normalised.detail,
        });
        break;
      case 'task':
        flushUser(at);
        items = applyTranscriptEvent(items, {
          type: 'background-task',
          sessionId: 'cli',
          id: normalised.id,
          title: normalised.title,
          status: normalised.phase === 'completed' ? 'completed' : 'running',
        });
        break;
      default:
        if (update.sessionUpdate === 'turn_completed') {
          flushUser(at);
          flushAnswer();
          flushThought();
        }
        break;
    }
  }

  flushUser(new Date().toISOString());
  flushAnswer();
  flushThought();

  if (items.length > maxItems) items = items.slice(-maxItems);
  return { items, changes };
}

function diffsFromCall(call: { content?: unknown }): FileChangeSummary[] {
  if (!Array.isArray(call.content)) return [];
  const found: FileChangeSummary[] = [];
  for (const entry of call.content) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { type?: string; path?: string; oldText?: string | null; newText?: string };
    if (record.type !== 'diff' || !record.path) continue;
    const relPath = record.path.replace(/^\.\//, '');
    found.push({
      path: relPath,
      relPath,
      status: record.oldText ? 'modified' : 'added',
      additions: 0,
      deletions: 0,
      revertable: false,
    });
  }
  return found;
}

export async function removeCliSessionDirectory(
  canonicalRoot: string,
  grokSessionId: string,
  grokHomeDir?: string,
): Promise<boolean> {
  const found = await findCliSession(canonicalRoot, grokSessionId, grokHomeDir);
  if (!found) return false;
  await rm(found.directory, { recursive: true, force: true });
  logger.info('CLI 세션 디렉터리를 삭제했습니다.', { grokSessionId, directory: found.directory });
  return true;
}

async function resolveGroupCwd(groupPath: string, encodedName: string): Promise<string | undefined> {
  const marker = await readFile(path.join(groupPath, '.cwd'), 'utf8').catch(() => '');
  if (marker.trim()) return marker.trim();
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return undefined;
  }
}

function mapReplayStatus(
  value: string | undefined,
): 'completed' | 'failed' | 'in-progress' | 'pending' | undefined {
  if (value === 'completed' || value === 'failed') return value;
  if (value === 'pending') return 'pending';
  if (value === 'in_progress') return 'in-progress';
  return undefined;
}

function toolOutputFromCall(call: { content?: unknown }): string | undefined {
  if (!Array.isArray(call.content)) return undefined;
  const parts = call.content
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const record = entry as { type?: string; content?: { type?: string; text?: string } };
      if (record.type === 'content' && record.content?.text) return record.content.text;
      return '';
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

const SEARCH_TEXT_CAP = 8_000;
const SEARCH_FILE_CAP = 200_000;

async function collectSearchText(directory: string, title: string, preview: string): Promise<string> {
  const parts = [title, preview];
  const file = path.join(directory, 'updates.jsonl');
  const raw = await readFile(file, 'utf8').catch(() => '');
  if (raw) {
    const slice = raw.length > SEARCH_FILE_CAP ? raw.slice(0, SEARCH_FILE_CAP) : raw;
    for (const line of slice.split('\n')) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      const update = (parsed as { params?: { update?: Record<string, unknown> } }).params?.update;
      if (!update) continue;
      const normalised = parseSessionUpdate(update);
      if (normalised.kind === 'user-message' || normalised.kind === 'agent-message') {
        const text = stripComposerDecorations(normalised.text).trim();
        if (text) parts.push(text);
      }
      if (parts.join('\n').length >= SEARCH_TEXT_CAP) break;
    }
  }
  return maskSecrets(parts.join('\n').slice(0, SEARCH_TEXT_CAP)).toLowerCase();
}

function asToolKind(value: string | undefined): ToolKind {
  switch (value) {
    case 'read':
    case 'search':
    case 'edit':
    case 'delete':
    case 'move':
    case 'execute':
    case 'fetch':
    case 'think':
      return value;
    default:
      return 'other';
  }
}

async function readSummary(directory: string): Promise<SummaryFile | null> {
  try {
    const raw = await readFile(path.join(directory, 'summary.json'), 'utf8');
    return JSON.parse(raw) as SummaryFile;
  } catch {
    return null;
  }
}
