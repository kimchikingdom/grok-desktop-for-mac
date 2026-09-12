import { describe, expect, it } from 'vitest';
import { normalizeUntrackedPatch, parseDiffHunks, parsePorcelainPath } from './diff.js';

describe('parseDiffHunks', () => {
  it('splits a unified diff into hunks keeping the file header', () => {
    const patch = [
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
      '@@ -8,1 +8,1 @@',
      '-x',
      '+y',
    ].join('\n');
    const hunks = parseDiffHunks(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.header).toContain('@@ -1,2 +1,2 @@');
    expect(hunks[0]?.patch).toContain('--- a/a.ts');
    expect(hunks[1]?.header).toContain('@@ -8,1 +8,1 @@');
  });
});

describe('parsePorcelainPath', () => {
  it('reads a plain path and unquotes C-escaped names', () => {
    expect(parsePorcelainPath(' M src/app.ts')).toBe('src/app.ts');
    expect(parsePorcelainPath('?? "foo bar.txt"')).toBe('foo bar.txt');
    expect(parsePorcelainPath('?? "nested/a\\tb.txt"')).toBe('nested/a\tb.txt');
  });
});

describe('normalizeUntrackedPatch', () => {
  it('names both sides after the file instead of the null device', () => {
    const patch = [
      'diff --git a/dev/null b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+export const a = 1;',
      '+',
    ].join('\n');
    const out = normalizeUntrackedPatch(patch, 'src/new.ts').split('\n');
    expect(out[0]).toBe('diff --git a/src/new.ts b/src/new.ts');
    expect(out[2]).toBe('--- /dev/null');
    expect(out[3]).toBe('+++ b/src/new.ts');
    expect(out[5]).toBe('+export const a = 1;');
  });

  it('leaves the body untouched', () => {
    const patch = '--- /dev/null\n+++ b/x\n@@ -0,0 +1 @@\n+--- not a header\n';
    expect(normalizeUntrackedPatch(patch, 'x')).toContain('+--- not a header');
  });
});
