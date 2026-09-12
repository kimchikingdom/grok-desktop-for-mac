import { describe, expect, it } from 'vitest';
import {
  autoApprovesEverything,
  parseMcpServers,
  parsePermissionMode,
  parseSkillDisabled,
  setMcpEnabled,
  setSkillDisabled,
} from './grok-config.js';

const SAMPLE = `
[models]
default = "grok-build"

[mcp_servers.github]
command = "npx"
enabled = true

[mcp_servers.notes]
command = "uvx"
enabled = false

[skills]
paths = ["~/extra"]
disabled = ["old"]
`;

describe('grok config edits', () => {
  it('toggles an existing MCP server without touching siblings', () => {
    const next = setMcpEnabled(SAMPLE, 'github', false);
    const servers = parseMcpServers(next);
    expect(servers.find((entry) => entry.name === 'github')?.enabled).toBe(false);
    expect(servers.find((entry) => entry.name === 'notes')?.enabled).toBe(false);
    expect(next).toContain('command = "npx"');
  });

  it('refuses unknown MCP names and unsafe identifiers', () => {
    expect(() => setMcpEnabled(SAMPLE, 'missing', true)).toThrow(/찾지/);
    expect(() => setMcpEnabled(SAMPLE, 'a/b', true)).toThrow(/허용되지/);
    const withPrefix = `${SAMPLE}\n[mcp_servers.github-extra]\ncommand = "x"\n`;
    const next = setMcpEnabled(withPrefix, 'github', false);
    expect(next).toContain('[mcp_servers.github-extra]');
    expect(parseMcpServers(next).find((entry) => entry.name === 'github-extra')?.enabled).toBe(true);
  });

  it('adds and removes skill names in [skills] disabled', () => {
    const off = setSkillDisabled(SAMPLE, 'review', true);
    expect(parseSkillDisabled(off).sort()).toEqual(['old', 'review']);
    const on = setSkillDisabled(off, 'old', false);
    expect(parseSkillDisabled(on)).toEqual(['review']);
  });
});

describe('parsePermissionMode', () => {
  const config = [
    '[cli]',
    'installer = "internal"',
    '',
    '[ui]',
    'compact_mode = false',
    'permission_mode = "always-approve"',
    '',
    '[models]',
    'default = "grok-4.6"',
  ].join('\n');

  it('reads the mode out of the [ui] block', () => {
    expect(parsePermissionMode(config)).toBe('always-approve');
  });

  it('returns nothing when the key or the block is absent', () => {
    expect(parsePermissionMode('[ui]\ncompact_mode = false\n')).toBeNull();
    expect(parsePermissionMode('[models]\npermission_mode = "ask"\n')).toBeNull();
    expect(parsePermissionMode('')).toBeNull();
  });

  it('flags the modes that skip asking', () => {
    expect(autoApprovesEverything('always-approve')).toBe(true);
    expect(autoApprovesEverything('bypassPermissions')).toBe(true);
    expect(autoApprovesEverything('yolo')).toBe(true);
    expect(autoApprovesEverything('ask')).toBe(false);
    expect(autoApprovesEverything('default')).toBe(false);
    expect(autoApprovesEverything(null)).toBe(false);
  });
})
