import { describe, expect, it } from 'vitest';
import type { ToolLocation } from '@grok-desktop/shared';
import { evaluatePermission, grantKeyFor } from './permission-engine.js';

const inside = (relPath: string): ToolLocation => ({
  path: `/work/${relPath}`,
  relPath,
  insideWorkspace: true,
});

const outside: ToolLocation = { path: '/etc/passwd', insideWorkspace: false };

describe('evaluatePermission', () => {
  it('auto-allows ordinary reads', () => {
    const result = evaluatePermission({
      profile: 'ask',
      kind: 'read',
      locations: [inside('src/index.ts')],
      sessionGrants: new Set(),
    });
    expect(result.decision).toBe('auto-allow');
  });

  it('always denies anything outside the workspace', () => {
    for (const profile of ['read-only', 'ask', 'trusted'] as const) {
      const result = evaluatePermission({
        profile,
        kind: 'read',
        locations: [outside],
        sessionGrants: new Set([grantKeyFor('read')]),
      });
      expect(result.decision).toBe('auto-deny');
      expect(result.risk).toBe('critical');
    }
  });

  it('asks before reading sensitive files even in trusted workspaces', () => {
    const result = evaluatePermission({
      profile: 'trusted',
      kind: 'read',
      locations: [inside('.env')],
      sessionGrants: new Set(),
    });
    expect(result.decision).toBe('ask');
    expect(result.alwaysAsk).toBe(true);
  });

  it('blocks every mutation in a read-only workspace', () => {
    for (const kind of ['edit', 'delete', 'move', 'execute', 'fetch'] as const) {
      const result = evaluatePermission({
        profile: 'read-only',
        kind,
        locations: [inside('src/index.ts')],
        command: 'ls',
        sessionGrants: new Set(),
      });
      expect(result.decision).toBe('auto-deny');
    }
  });

  it('honours a session grant only for the same path', () => {
    const grants = new Set([grantKeyFor('edit', 'src/index.ts')]);
    const same = evaluatePermission({
      profile: 'ask',
      kind: 'edit',
      locations: [inside('src/index.ts')],
      sessionGrants: grants,
    });
    expect(same.decision).toBe('auto-allow');
    const other = evaluatePermission({
      profile: 'ask',
      kind: 'edit',
      locations: [inside('package.json')],
      sessionGrants: grants,
    });
    expect(other.decision).toBe('ask');
  });

  it('ignores session grants for always-ask commands', () => {
    const result = evaluatePermission({
      profile: 'trusted',
      kind: 'execute',
      locations: [],
      command: 'git push origin main',
      sessionGrants: new Set([grantKeyFor('execute')]),
    });
    expect(result.decision).toBe('ask');
    expect(result.alwaysAsk).toBe(true);
  });

  it('denies file mutations that name no path', () => {
    const result = evaluatePermission({
      profile: 'trusted',
      kind: 'edit',
      locations: [],
      sessionGrants: new Set(),
    });
    expect(result.decision).toBe('auto-deny');
  });

  it('lets a trusted workspace edit ordinary files without asking', () => {
    const result = evaluatePermission({
      profile: 'trusted',
      kind: 'edit',
      locations: [inside('src/app.ts')],
      sessionGrants: new Set(),
    });
    expect(result.decision).toBe('auto-allow');
  });

  it('still asks before deleting in a trusted workspace', () => {
    const result = evaluatePermission({
      profile: 'trusted',
      kind: 'delete',
      locations: [inside('src/app.ts')],
      sessionGrants: new Set([grantKeyFor('delete')]),
    });
    expect(result.decision).toBe('ask');
  });
});
