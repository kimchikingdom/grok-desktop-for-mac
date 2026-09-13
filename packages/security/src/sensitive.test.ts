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

describe('Git 내부 디렉터리', () => {
  it('훅과 설정은 민감하게 다룬다', () => {
    // git runs these on ordinary commands the app issues, so a write here is
    // code execution without an approval card.
    expect(isSensitivePath('.git/config')).toBe(true);
    expect(isSensitivePath('.git/hooks/pre-commit')).toBe(true);
    expect(isSensitivePath('nested/.git/config')).toBe(true);
    expect(isSensitivePath('.git')).toBe(true);
  });

  it('사용자가 손대는 git 파일은 그대로 둔다', () => {
    expect(isSensitivePath('.gitignore')).toBe(false);
    expect(isSensitivePath('.gitattributes')).toBe(false);
    expect(isSensitivePath('.github/workflows/ci.yml')).toBe(false);
    expect(isSensitivePath('src/.gitkeep')).toBe(false);
  });
})
