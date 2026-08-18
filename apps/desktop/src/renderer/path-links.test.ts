import { describe, expect, it } from 'vitest';
import { ancestorDirs, looksLikeWorkspacePath, parentDir, parseWorkspaceRef, relativeTime, splitLinkableText } from './path-links.js';

describe('looksLikeWorkspacePath', () => {
  it('accepts relative source paths and drops urls or escapes', () => {
    expect(looksLikeWorkspacePath('src/app.ts')).toBe('src/app.ts');
    expect(looksLikeWorkspacePath('./README.md')).toBe('README.md');
    expect(looksLikeWorkspacePath('src/app.ts:12')).toBe('src/app.ts');
    expect(looksLikeWorkspacePath('https://example.com/a.ts')).toBeNull();
    expect(looksLikeWorkspacePath('/etc/passwd')).toBeNull();
    expect(looksLikeWorkspacePath('../secret.env')).toBeNull();
    expect(looksLikeWorkspacePath('e.g. this')).toBeNull();
  });
});

describe('parseWorkspaceRef', () => {
  it('keeps a 1-based line when the path is tagged', () => {
    expect(parseWorkspaceRef('src/app.ts:12')).toEqual({ relPath: 'src/app.ts', line: 12 });
    expect(parseWorkspaceRef('`src/app.ts:12:4`')).toEqual({ relPath: 'src/app.ts', line: 12 });
    expect(parseWorkspaceRef('src/app.ts#L12')).toEqual({ relPath: 'src/app.ts', line: 12 });
    expect(parseWorkspaceRef('src/app.ts')).toEqual({ relPath: 'src/app.ts' });
  });
});

describe('splitLinkableText', () => {
  it('keeps surrounding text and marks backtick paths', () => {
    const parts = splitLinkableText('see `src/app.ts` please');
    expect(parts.some((part) => part.relPath === 'src/app.ts')).toBe(true);
    expect(parts.map((part) => part.value).join('')).toBe('see `src/app.ts` please');
  });

  it('carries a line number from a path:line mention', () => {
    const parts = splitLinkableText('look at src/app.ts:12 next');
    expect(parts.some((part) => part.relPath === 'src/app.ts' && part.line === 12)).toBe(true);
  });
});

describe('parentDir', () => {
  it('returns the workspace-relative parent, or root for a top-level file', () => {
    expect(parentDir('src/app.ts')).toBe('src');
    expect(parentDir('src/lib/util.ts')).toBe('src/lib');
    expect(parentDir('README.md')).toBe('');
  });
});

describe('ancestorDirs', () => {
  it('lists parent folders only, never the file itself', () => {
    expect(ancestorDirs('src/lib/util.ts')).toEqual(['src', 'src/lib']);
    expect(ancestorDirs('README.md')).toEqual([]);
    expect(ancestorDirs('Makefile')).toEqual([]);
    expect(ancestorDirs('.github/workflows/ci.yml')).toEqual(['.github', '.github/workflows']);
  });
});

describe('relativeTime', () => {
  it('speaks in minutes and hours', () => {
    const now = Date.parse('2026-08-15T12:00:00.000Z');
    expect(relativeTime('2026-08-15T11:59:30.000Z', now)).toBe('방금');
    expect(relativeTime('2026-08-15T11:40:00.000Z', now)).toBe('20분 전');
    expect(relativeTime('2026-08-15T09:00:00.000Z', now)).toBe('3시간 전');
  });
});
