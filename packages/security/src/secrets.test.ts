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
