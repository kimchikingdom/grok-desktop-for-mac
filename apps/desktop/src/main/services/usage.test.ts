import { describe, expect, it } from 'vitest';
import { parseQuota } from './session-manager.js';
import { parseSessionUsage } from './usage.js';

const REAL_429 =
  'API error (status 429 Too Many Requests): subscription:free-usage-exhausted: ' +
  "You've used all the included free usage for model grok-4.6 for now. " +
  'Usage resets over a rolling 24-hour window — tokens (actual/limit): 508641/500000.';

describe('parseQuota', () => {
  it('reads the rolling-window numbers out of a real 429 body', () => {
    const quota = parseQuota(REAL_429);
    expect(quota?.usedTokens).toBe(508641);
    expect(quota?.limitTokens).toBe(500000);
    expect(Date.parse(quota?.observedAt ?? '')).not.toBeNaN();
  });

  it('returns nothing when the message carries no numbers', () => {
    expect(parseQuota('429 Too Many Requests')).toBeUndefined();
    expect(parseQuota('세션을 찾을 수 없습니다.')).toBeUndefined();
  });

  it('tolerates spacing differences', () => {
    expect(parseQuota('tokens (actual/limit) : 10 / 20')?.limitTokens).toBe(20);
  });
});

describe('parseSessionUsage', () => {
  // Trimmed from a real `grok usage <session-id>` run on CLI 1.0.30.
  const REAL = JSON.stringify({
    sessionId: '01a0012e-e1c0-7c52-8f2f-40ca2545c65b',
    updatedAt: '2026-09-12T10:38:31.997489+00:00',
    session: {
      inputTokens: 16636,
      outputTokens: 111,
      cachedReadTokens: 3072,
      cacheCreationTokens: 0,
      reasoningTokens: 74,
      totalTokens: 16747,
      modelCalls: 1,
      costUsdTicks: 99722000,
      turnCount: 1,
      primaryModelId: 'grok-4.6-build',
      modelUsage: {},
    },
    turns: [],
  });

  it('reads the session totals the CLI persisted', () => {
    const usage = parseSessionUsage(REAL);
    expect(usage).toMatchObject({
      totalTokens: 16747,
      inputTokens: 16636,
      outputTokens: 111,
      cachedReadTokens: 3072,
      reasoningTokens: 74,
      modelCalls: 1,
      turnCount: 1,
      primaryModelId: 'grok-4.6-build',
      updatedAt: '2026-09-12T10:38:31.997489+00:00',
    });
  });

  it('returns nothing for a session the CLI has not recorded', () => {
    expect(parseSessionUsage("Error: No usage recorded for session 'x'.")).toBeNull();
    expect(parseSessionUsage('')).toBeNull();
    expect(parseSessionUsage('{"sessionId":"x"}')).toBeNull();
  });

  it('treats an all-zero record as nothing to show', () => {
    expect(parseSessionUsage('{"session":{"totalTokens":0,"inputTokens":0,"outputTokens":0}}')).toBeNull();
  });

  it('drops junk values instead of rendering NaN', () => {
    const usage = parseSessionUsage(
      '{"session":{"totalTokens":10,"inputTokens":"nope","outputTokens":-5,"modelCalls":null},"updatedAt":42}',
    );
    expect(usage).toMatchObject({ totalTokens: 10, inputTokens: 0, outputTokens: 0, modelCalls: 0 });
    expect(Date.parse(usage?.updatedAt ?? '')).not.toBeNaN();
  });
})
