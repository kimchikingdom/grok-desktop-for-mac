import { describe, expect, it } from 'vitest';
import { containsSecret, maskDeep, maskSecrets } from './secrets.js';

describe('maskSecrets', () => {
  it('masks xAI and OpenAI style keys', () => {
    const masked = maskSecrets('key=xai-abcdefghijklmnopqrstuvwxyz0123');
    expect(masked).not.toContain('abcdefghijklmnop');
    expect(masked).toContain('[redacted:xai-key]');
  });

  it('masks bearer tokens but keeps the scheme', () => {
    const masked = maskSecrets('Authorization: Bearer abcdef1234567890abcdef');
    expect(masked).toContain('Bearer [redacted:bearer-token]');
  });

  it('masks env-style secrets by name', () => {
    const masked = maskSecrets('DATABASE_PASSWORD=hunter2000\nPORT=3000');
    expect(masked).toContain('PORT=3000');
    expect(masked).not.toContain('hunter2000');
  });

  it('masks private key blocks entirely', () => {
    const input = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----';
    expect(maskSecrets(input)).toBe('[redacted:private-key]');
  });

  it('masks JWTs', () => {
    const masked = maskSecrets('token eyJhbGciOi.eyJzdWIiOiIxMjM.SflKxwRJSMeKKF2QT4');
    expect(masked).toContain('[redacted:jwt]');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'src/index.ts 파일에서 함수 3개를 수정했습니다.';
    expect(maskSecrets(text)).toBe(text);
    expect(containsSecret(text)).toBe(false);
  });

  it('masks nested object values', () => {
    const masked = maskDeep({ a: { b: ['ghp_abcdefghijklmnopqrstuvwxyz012345'] } });
    expect(JSON.stringify(masked)).toContain('[redacted:github-token]');
  });
});

describe('놓치던 형태', () => {
  it('JSON 으로 적힌 비밀도 가린다', () => {
    expect(maskSecrets('{"API_TOKEN": "supersecretvalue123"}')).not.toContain('supersecretvalue123');
    expect(maskSecrets('{"apiKey":"supersecretvalue123"}')).not.toContain('supersecretvalue123');
    expect(maskSecrets('{"databasePassword": "hunter2hunter2"}')).not.toContain('hunter2hunter2');
  });

  it('최근 자격증명 포맷을 안다', () => {
    // Assembled from pieces on purpose: a literal of the right shape trips
    // GitHub's push protection, even though these are made up.
    const body = 'ABCDEFGHIJKLMNOPQRSTUVWX';
    const samples = [
      `github${'_'}pat${'_'}11${body}0aBcDe`,
      `glpat${'-'}${body}`,
      `sk${'_'}live${'_'}${body}`,
      `sk${'-'}ant${'-'}api03${'-'}${body}`,
      `https://hooks.slack.com/${'services'}/T00000000/B00000000/${body}`,
    ];
    for (const sample of samples) {
      expect(maskSecrets(`값: ${sample}`), sample).not.toContain(sample);
    }
  });

  it('평범한 로그 문장은 그대로 둔다', () => {
    const line = '세션을 시작했습니다. sessionId: 01a0012e-e1c0-7c52';
    expect(maskSecrets(line)).toBe(line);
    expect(maskSecrets('git status 를 실행합니다')).toBe('git status 를 실행합니다');
  });
})
