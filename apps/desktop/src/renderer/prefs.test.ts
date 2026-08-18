import { describe, expect, it } from 'vitest';
import { readRecentMap, readStringList, rememberPath, toggleId } from './prefs.js';

describe('prefs lists', () => {
  it('reads only non-empty strings and caps the length', () => {
    expect(readStringList(null)).toEqual([]);
    expect(readStringList('{"a":1}')).toEqual([]);
    expect(readStringList('["a","","b",3]', 2)).toEqual(['a', 'b']);
  });

  it('toggles an id to the front and remembers recent paths', () => {
    expect(toggleId(['b'], 'a')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    expect(rememberPath(['b.ts', 'a.ts'], 'a.ts', 8)).toEqual(['a.ts', 'b.ts']);
    expect(rememberPath(['a.ts', 'b.ts'], 'c.ts', 2)).toEqual(['c.ts', 'a.ts']);
  });

  it('keeps recent files per workspace and drops the old flat list', () => {
    expect(readRecentMap('["src/a.ts"]')).toEqual({});
    expect(readRecentMap('{"ws-1":["src/a.ts","","b.ts"],"ws-2":["c.ts"]}')).toEqual({
      'ws-1': ['src/a.ts', 'b.ts'],
      'ws-2': ['c.ts'],
    });
  });
});
