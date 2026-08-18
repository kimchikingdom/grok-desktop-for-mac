import type { PromptToolFlag, WorkMode } from '@grok-desktop/shared';

const MODE_PREFIX: Record<WorkMode, string> = {
  ask: '[모드: Ask] 질문에 답하고 필요한 파일만 읽어라. 파일 수정이나 명령 실행은 하지 마라.\n\n',
  plan: '[모드: Plan] 먼저 단계별 실행 계획을 제시하라. 승인 없이 파일을 바꾸거나 명령을 실행하지 마라.\n\n',
  agent: '[모드: Agent] 필요한 변경을 수행하되, 상태를 바꾸는 작업은 승인 요청을 통해 진행하라.\n\n',
};

const TOOL_SLASH: Record<PromptToolFlag, string> = {
  imagine: '/imagine ',
  'imagine-video': '/imagine-video ',
  think: '',
  'deep-research': '/deep-research ',
};

export function looksLikeSlashCommand(text: string): boolean {
  return /^\s*\/[a-zA-Z]/.test(text);
}

export const SIDE_ASK_INSTRUCTION =
  '옆 질문이다. 지금 하던 작업을 바꾸거나 파일을 고치지 말고 짧게만 답하라.';

export function composePromptText(input: {
  mode: WorkMode;
  text: string;
  attachments: string[];
  instructions?: string;
  tools?: PromptToolFlag[];
  sideAsk?: boolean;
}): string {
  const trimmed = input.text.trim();
  const tools = input.tools ?? [];
  const missing = input.attachments.filter((relPath) => !input.text.includes(`@${relPath}`));
  const attachments =
    missing.length > 0 ? `\n\n참고할 파일: ${missing.map((relPath) => `@${relPath}`).join(', ')}` : '';

  const instruction = input.instructions?.trim()
    ? `프로젝트 지시사항:\n${input.instructions.trim()}\n\n`
    : '';

  if (looksLikeSlashCommand(trimmed)) {
    return instruction + trimmed + attachments;
  }

  const slashTool = tools.find((tool) => TOOL_SLASH[tool]);
  if (slashTool) {
    return `${instruction}${TOOL_SLASH[slashTool]}${trimmed}${attachments}`;
  }

  const header: string[] = [];
  if (instruction) header.push(instruction);
  if (tools.includes('think')) {
    header.push('답하기 전에 추론 과정을 먼저 정리하라.\n');
  }
  header.push(MODE_PREFIX[input.mode]);
  if (input.sideAsk) header.push(`${SIDE_ASK_INSTRUCTION}\n`);
  return `${header.join('\n')}${trimmed}${attachments}`;
}
