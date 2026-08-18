import { describe, expect, it } from 'vitest';
import { extractCommand, extractPaths, normalizeKind } from './session-manager.js';

describe('normalizeKind', () => {
  it('passes through the kinds the agent reports', () => {
    expect(normalizeKind('read')).toBe('read');
    expect(normalizeKind('execute')).toBe('execute');
  });

  it('maps unknown kinds to other', () => {
    expect(normalizeKind('switch_mode')).toBe('other');
  });

  it('returns undefined when no kind was sent, so updates keep the known kind', () => {
    // Real traffic: `tool_call` carries kind:"read", the later
    // `tool_call_update` carries only a status. The card must stay a read.
    expect(normalizeKind(undefined)).toBeUndefined();
    const previous = normalizeKind('read');
    expect(normalizeKind(undefined) ?? previous ?? 'other').toBe('read');
  });
});

describe('extractCommand', () => {
  it('finds the command under the usual keys', () => {
    expect(extractCommand({ command: 'pnpm test' })).toBe('pnpm test');
    expect(extractCommand({ cmd: 'ls -la' })).toBe('ls -la');
  });

  it('joins argv-style arrays', () => {
    expect(extractCommand({ command: ['git', 'status'] })).toBe('git status');
  });

  it('returns undefined for unrelated payloads', () => {
    expect(extractCommand({ path: 'src/index.ts' })).toBeUndefined();
    expect(extractCommand(null)).toBeUndefined();
  });
});

describe('extractPaths', () => {
  it('collects single and list-shaped path fields', () => {
    expect(extractPaths({ file_path: 'a.ts' })).toEqual(['a.ts']);
    expect(extractPaths({ paths: ['a.ts', 'b.ts'] })).toEqual(['a.ts', 'b.ts']);
    expect(extractPaths({ source: 'a.ts', destination: 'b.ts' })).toEqual(['b.ts', 'a.ts']);
  });

  it('ignores non-string entries', () => {
    expect(extractPaths({ paths: [1, 'a.ts'] })).toEqual(['a.ts']);
    expect(extractPaths('nope')).toEqual([]);
  });
});
