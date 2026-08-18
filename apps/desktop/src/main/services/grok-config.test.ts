import { describe, expect, it } from 'vitest';
import { parseMcpServers, parseSkillDisabled, setMcpEnabled, setSkillDisabled } from './grok-config.js';

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
