import { describe, expect, it } from 'vitest';
import { isSensitivePath } from './sensitive.js';

describe('isSensitivePath', () => {
  it('flags env, direnv, and grok credential files', () => {
    expect(isSensitivePath('.env')).toBe(true);
    expect(isSensitivePath('.env.local')).toBe(true);
    expect(isSensitivePath('.env.example')).toBe(false);
    expect(isSensitivePath('.envrc')).toBe(true);
    expect(isSensitivePath('config/secrets.env')).toBe(true);
    expect(isSensitivePath('auth.json')).toBe(true);
    expect(isSensitivePath('tokens.json')).toBe(true);
    expect(isSensitivePath('.grok/session.json')).toBe(true);
  });
});
