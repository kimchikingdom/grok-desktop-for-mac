import { describe, expect, it } from 'vitest';
import { normalizeUntrackedPatch, parseDiffHunks, parseNumstat, parsePorcelainPath, pathsInPatch } from './diff.js';

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

  it('decodes an octal-escaped Korean name as UTF-8', () => {
    expect(parsePorcelainPath('?? "\\355\\225\\234\\352\\270\\200 \\355\\214\\214\\354\\235\\274.txt"')).toBe(
      '한글 파일.txt',
    );
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

describe('parseNumstat', () => {
  const record = (line: string) => `${line}\0`;

  it('reads additions and deletions per file', () => {
    const stdout = [record('2\t1\tsrc/app.ts'), record('0\t7\tsrc/old.ts')].join('');
    const counts = parseNumstat(stdout);
    expect(counts.get('src/app.ts')).toEqual({ additions: 2, deletions: 1 });
    expect(counts.size).toBe(2);
  });

  it('counts a binary file as zero instead of failing', () => {
    const counts = parseNumstat(record('-\t-\tassets/logo.png'));
    expect(counts.get('assets/logo.png')).toEqual({ additions: 0, deletions: 0 });
  });

  it('keeps paths with spaces and Korean characters intact', () => {
    const stdout = [record('1\t0\t한글 파일.txt'), record('3\t2\tdocs/사용 설명서.md')].join('');
    const counts = parseNumstat(stdout);
    expect(counts.get('한글 파일.txt')).toEqual({ additions: 1, deletions: 0 });
    expect(counts.get('docs/사용 설명서.md')).toEqual({ additions: 3, deletions: 2 });
  });

  it('fills deletions for a removed file', () => {
    const counts = parseNumstat(record('0\t12\tgone.txt'));
    expect(counts.get('gone.txt')).toEqual({ additions: 0, deletions: 12 });
  });

  it('returns nothing for empty or malformed output', () => {
    expect(parseNumstat('').size).toBe(0);
    expect(parseNumstat('\0\0').size).toBe(0);
    expect(parseNumstat(record('2\tsrc/app.ts')).size).toBe(0);
  });
});

describe('pathsInPatch', () => {
  const patch = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 111..222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');

  it('collects every file a patch names', () => {
    expect(pathsInPatch(patch)).toEqual(['src/app.ts']);
  });

  it('reports both sides of a rename', () => {
    const renamed = 'diff --git a/old/name.ts b/new/name.ts\n--- a/old/name.ts\n+++ b/new/name.ts\n';
    expect(pathsInPatch(renamed).sort()).toEqual(['new/name.ts', 'old/name.ts']);
  });

  it('skips the null device of a new or deleted file', () => {
    const added = 'diff --git a/x.ts b/x.ts\n--- /dev/null\n+++ b/x.ts\n@@ -0,0 +1 @@\n+hi\n';
    expect(pathsInPatch(added)).toEqual(['x.ts']);
  });

  it('surfaces a path that would escape the workspace so the caller can refuse it', () => {
    const escaping = 'diff --git a/../../outside.ts b/../../outside.ts\n--- a/../../outside.ts\n+++ b/../../outside.ts\n';
    expect(pathsInPatch(escaping)).toContain('../../outside.ts');
  });

  it('ignores body lines that look like headers', () => {
    const tricky = '--- a/real.ts\n+++ b/real.ts\n@@ -1,2 +1,2 @@\n+--- a/fake.ts\n';
    expect(pathsInPatch(tricky)).toEqual(['real.ts']);
  });
})
