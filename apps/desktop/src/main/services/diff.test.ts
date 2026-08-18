import { describe, expect, it } from 'vitest';
import { parseDiffHunks, parsePorcelainPath } from './diff.js';

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
