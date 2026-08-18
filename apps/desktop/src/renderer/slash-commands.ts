import type { PromptToolFlag, WorkMode } from '@grok-desktop/shared';

export type SlashGroup = 'session' | 'mode' | 'agent';

export type SlashCommand = {
  id: string;
  title: string;
  hint: string;
  group: SlashGroup;
  /** Handled in the app instead of being sent to the agent. */
  local?: boolean;
  /** Palette click inserts the command; the user must type the rest. */
  needsRest?: boolean;
};

export const SLASH_GROUPS: { id: SlashGroup; label: string }[] = [
  { id: 'session', label: '대화' },
  { id: 'mode', label: '모드' },
  { id: 'agent', label: '에이전트' },
];

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'new', title: '/new', hint: '새 대화 시작', group: 'session', local: true },
  { id: 'rename', title: '/rename', hint: '이름 바꾸기. 예: /rename 설계 검토', group: 'session', local: true, needsRest: true },
  { id: 'delete', title: '/delete', hint: '이 대화 삭제', group: 'session', local: true },
  { id: 'export', title: '/export', hint: '대화를 마크다운으로 복사', group: 'session', local: true },
  { id: 'copy', title: '/copy', hint: '마지막 답변 복사', group: 'session', local: true },
  { id: 'fork', title: '/fork', hint: '이 대화를 분기', group: 'session', local: true },
  { id: 'review', title: '/review', hint: '변경 리뷰 패널 열기', group: 'session', local: true },
  { id: 'open', title: '/open', hint: '파일 빠른 열기', group: 'session', local: true },
  { id: 'help', title: '/help', hint: '단축키와 명령 보기', group: 'session', local: true },
  { id: 'ask', title: '/ask', hint: '질문 모드 (읽기 전용)', group: 'mode', local: true },
  { id: 'plan', title: '/plan', hint: '계획 모드', group: 'mode', local: true },
  { id: 'agent', title: '/agent', hint: '에이전트 모드', group: 'mode', local: true },
  { id: 'imagine', title: '/imagine', hint: '이미지 생성. 예: /imagine 붉은 여우', group: 'agent' },
  { id: 'imagine-video', title: '/imagine-video', hint: '영상 생성', group: 'agent' },
  { id: 'deep-research', title: '/deep-research', hint: '심층 조사', group: 'agent' },
  { id: 'compact', title: '/compact', hint: '대화 압축', group: 'agent' },
  { id: 'remember', title: '/remember', hint: '메모리에 남기기. 예: /remember uv 사용', group: 'agent' },
  { id: 'btw', title: '/btw', hint: '본 작업을 끊지 않는 옆 질문. 예: /btw 이 함수 뭐 해', group: 'session', local: true, needsRest: true },
  { id: 'context', title: '/context', hint: '컨텍스트 사용량', group: 'agent' },
  { id: 'effort', title: '/effort', hint: '추론 강도', group: 'agent' },
  { id: 'tasks', title: '/tasks', hint: '백그라운드 작업·서브에이전트', group: 'agent' },
  { id: 'usage', title: '/usage', hint: '사용량 안내', group: 'agent' },
];

/** `/` or `/ima` keeps the palette open. A space means the user is typing arguments. */
export function slashQueryFromDraft(text: string): string | null {
  if (!text.startsWith('/')) return null;
  if (text.includes('\n') || /\s/.test(text)) return null;
  return text;
}

export function filterSlashCommands(query: string): SlashCommand[] {
  const needle = query.replace(/^\//, '').toLowerCase();
  if (!needle) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (command) => command.id.includes(needle) || command.title.slice(1).startsWith(needle),
  );
}

export function groupedSlashCommands(matches: SlashCommand[]): { id: SlashGroup; label: string; items: SlashCommand[] }[] {
  return SLASH_GROUPS.map((group) => ({
    ...group,
    items: matches.filter((command) => command.group === group.id),
  })).filter((group) => group.items.length > 0);
}

export function parseLeadingSlash(text: string): { id: string; rest: string } | null {
  const match = /^\/([a-zA-Z][\w-]*)(?:\s+([\s\S]+))?$/.exec(text.trim());
  if (!match?.[1]) return null;
  return { id: match[1].toLowerCase(), rest: match[2]?.trim() ?? '' };
}

export function toolForSlash(id: string): PromptToolFlag | undefined {
  if (id === 'imagine' || id === 'imagine-video' || id === 'deep-research') return id;
  return undefined;
}

export function modeForSlash(id: string): WorkMode | undefined {
  if (id === 'ask' || id === 'plan' || id === 'agent') return id;
  return undefined;
}
