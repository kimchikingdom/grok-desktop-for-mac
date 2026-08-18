import { describe, expect, it } from 'vitest';
import { classifyTurnError } from './session-manager.js';

describe('classifyTurnError', () => {
  it('recognises the free-usage-exhausted 429 from the responses API', () => {
    const raw =
      'API error (status 429 Too Many Requests): subscription:free-usage-exhausted: ' +
      "You've used all the included free usage for model grok-4.6 for now.";
    const result = classifyTurnError(raw);
    expect(result.code).toBe('quota-exceeded');
    expect(result.message).toContain('grok logout && grok login');
  });

  it('recognises expired auth', () => {
    expect(classifyTurnError('401 Unauthorized: token expired').code).toBe('auth-required');
  });

  it('recognises timeouts and network failures', () => {
    expect(classifyTurnError('Timed out after 180000ms waiting for session/prompt').code).toBe('timeout');
    expect(classifyTurnError('connect ECONNREFUSED 127.0.0.1:443').code).toBe('network');
  });

  it('passes anything else through unchanged', () => {
    const result = classifyTurnError('세션을 찾을 수 없습니다.');
    expect(result.code).toBe('prompt-failed');
    expect(result.message).toBe('세션을 찾을 수 없습니다.');
  });

  it('does not treat docker login as expired xAI auth', () => {
    expect(classifyTurnError('cannot login to docker registry (403)').code).toBe('prompt-failed');
  });
});
