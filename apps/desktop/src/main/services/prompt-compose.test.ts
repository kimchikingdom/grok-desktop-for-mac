import { describe, expect, it } from 'vitest';
import { composePromptText, looksLikeSlashCommand } from './prompt-compose.js';

describe('looksLikeSlashCommand', () => {
  it('detects a leading slash command', () => {
    expect(looksLikeSlashCommand('/imagine a cat')).toBe(true);
    expect(looksLikeSlashCommand('  /compact')).toBe(true);
    expect(looksLikeSlashCommand('imagine a cat')).toBe(false);
    expect(looksLikeSlashCommand('/ 빈칸')).toBe(false);
  });
});

describe('composePromptText', () => {
  it('passes slash commands through without a mode prefix', () => {
    expect(composePromptText({ mode: 'agent', text: '/imagine sunset', attachments: [] })).toBe(
      '/imagine sunset',
    );
  });

  it('wraps imagine tool as a slash command', () => {
    expect(
      composePromptText({
        mode: 'ask',
        text: 'a red bicycle',
        attachments: [],
        tools: ['imagine'],
      }),
    ).toBe('/imagine a red bicycle');
  });

  it('prepends instructions, think, and attachments for a normal prompt', () => {
    const text = composePromptText({
      mode: 'agent',
      text: '고치기',
      attachments: ['src/a.ts'],
      instructions: '한국어로 답하기',
      tools: ['think'],
    });
    expect(text).toContain('프로젝트 지시사항:\n한국어로 답하기');
    expect(text).toContain('추론 과정');
    expect(text).toContain('[모드: Agent]');
    expect(text).toContain('@src/a.ts');
    expect(text).toContain('고치기');
  });

  it('adds a side-ask instruction without changing the visible user text', () => {
    const text = composePromptText({
      mode: 'agent',
      text: '이 함수가 뭐 해',
      attachments: [],
      sideAsk: true,
    });
    expect(text).toContain('옆 질문이다');
    expect(text).toContain('이 함수가 뭐 해');
    expect(text).toContain('[모드: Agent]');
  });
});
