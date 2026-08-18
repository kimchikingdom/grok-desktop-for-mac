import { describe, expect, it } from 'vitest';
import { parseQuota } from './session-manager.js';

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
