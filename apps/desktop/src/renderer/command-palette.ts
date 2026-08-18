export type PaletteCommand = {
  id: string;
  title: string;
  hint: string;
  keywords: string;
};

export const PALETTE_COMMANDS: PaletteCommand[] = [
  { id: 'new', title: '새 대화', hint: '같은 폴더에서 대화를 시작합니다', keywords: 'new chat session' },
  { id: 'worktree', title: '워크트리로 새 대화', hint: '격리된 워크트리에서 시작합니다', keywords: 'worktree isolate' },
  { id: 'review', title: '리뷰 열기', hint: '변경 파일과 diff를 엽니다', keywords: 'diff review changes' },
  { id: 'side-ask', title: '옆 질문', hint: '본 작업을 끊지 않고 묻습니다', keywords: 'btw side ask' },
  { id: 'files', title: '파일 검색', hint: '사이드바에서 파일을 찾습니다', keywords: 'search files' },
  { id: 'fork', title: '이 대화 분기', hint: '지금까지를 복사해 새 대화를 엽니다', keywords: 'fork branch' },
  { id: 'export', title: '대화 내보내기', hint: '마크다운으로 복사합니다', keywords: 'export copy markdown' },
  { id: 'copy', title: '마지막 답변 복사', hint: '가장 최근 답변을 복사합니다', keywords: 'copy answer' },
  { id: 'ask', title: '질문 모드', hint: '읽기 전용으로 바꿉니다', keywords: 'ask mode' },
  { id: 'plan', title: '계획 모드', hint: '변경 없이 계획만 세웁니다', keywords: 'plan mode' },
  { id: 'agent', title: '에이전트 모드', hint: '파일 수정과 명령을 허용합니다', keywords: 'agent mode' },
  { id: 'continue-plan', title: '이 계획으로 진행', hint: '마지막 계획을 실행합니다', keywords: 'continue plan' },
  { id: 'cancel', title: '실행 중단', hint: '현재 턴을 멈춥니다', keywords: 'stop cancel' },
  { id: 'restart', title: '다시 연결', hint: '에이전트 연결을 다시 시작합니다', keywords: 'reconnect restart' },
  { id: 'settings', title: '설정', hint: '권한·샌드박스·MCP', keywords: 'settings preferences' },
  { id: 'shortcuts', title: '단축키', hint: '키보드 목록을 엽니다', keywords: 'shortcuts help' },
];

export function filterPaletteCommands(query: string): PaletteCommand[] {
  const needle = query.replace(/^>/, '').trim().toLowerCase();
  if (!needle) return PALETTE_COMMANDS;
  return PALETTE_COMMANDS.filter(
    (command) =>
      command.id.includes(needle) ||
      command.title.toLowerCase().includes(needle) ||
      command.keywords.includes(needle),
  );
}
