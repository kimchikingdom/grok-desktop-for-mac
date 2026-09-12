/**
 * Conservative edits to ~/.grok/config.toml. Only flips known MCP `enabled`
 * keys and the `[skills] disabled` list — never invents servers or writes secrets.
 */

const NAME = /^[A-Za-z0-9._-]+$/;

export function assertConfigName(name: string): string {
  if (!NAME.test(name)) throw new Error('허용되지 않는 이름입니다.');
  return name;
}

export function parseMcpServers(toml: string): { name: string; enabled: boolean }[] {
  const mcp: { name: string; enabled: boolean }[] = [];
  const section = /\[mcp_servers\.([^\]]+)\]([\s\S]*?)(?=\n\[|$)/g;
  let match: RegExpExecArray | null;
  while ((match = section.exec(toml))) {
    const name = match[1] ?? 'unknown';
    const enabled = !/enabled\s*=\s*false/.test(match[2] ?? '');
    mcp.push({ name, enabled });
  }
  return mcp;
}

export function parseSkillDisabled(toml: string): string[] {
  const block = toml.match(/\[skills\]([\s\S]*?)(?=\n\[|$)/);
  if (!block?.[1]) return [];
  const list = block[1].match(/disabled\s*=\s*\[([\s\S]*?)\]/);
  if (!list?.[1]) return [];
  return [...list[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]).filter((name): name is string => Boolean(name));
}

/**
 * `[ui] permission_mode` in ~/.grok/config.toml. When it auto-approves, the CLI
 * runs its own tools without ever asking this app, so the approval cards stop
 * being the gate the UI claims they are. Only reported, never rewritten: it is
 * the user's CLI setting, and the CLI has no flag to override it per run.
 */
export function parsePermissionMode(toml: string): string | null {
  const block = /\[ui\]([\s\S]*?)(?=\n\[|$)/.exec(toml);
  const value = /^\s*permission_mode\s*=\s*"([^"]*)"/m.exec(block?.[1] ?? '');
  return value?.[1] ?? null;
}

/** True for the modes that let the CLI skip asking (`always-approve`, `bypass*`, `yolo`). */
export function autoApprovesEverything(mode: string | null): boolean {
  if (!mode) return false;
  return /always.?approve|bypass|yolo|accept.?edits|full.?auto/i.test(mode);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function setMcpEnabled(toml: string, name: string, enabled: boolean): string {
  const safe = assertConfigName(name);
  const header = `[mcp_servers.${safe}]`;
  const found = toml.match(new RegExp(`\\[mcp_servers\\.${escapeRegExp(safe)}\\](?=\\s|$)`));
  const index = found?.index ?? -1;
  if (index < 0) throw new Error(`MCP 서버 ${safe}를 설정에서 찾지 못했습니다.`);
  const start = index + header.length;
  const nextHeader = toml.indexOf('\n[', start);
  const end = nextHeader === -1 ? toml.length : nextHeader;
  const body = toml.slice(start, end);
  const nextBody = /enabled\s*=\s*(true|false)/.test(body)
    ? body.replace(/enabled\s*=\s*(true|false)/, `enabled = ${enabled}`)
    : `\nenabled = ${enabled}${body.startsWith('\n') ? '' : '\n'}${body}`;
  return `${toml.slice(0, start)}${nextBody}${toml.slice(end)}`;
}

export function setSkillDisabled(toml: string, name: string, disabled: boolean): string {
  const safe = assertConfigName(name);
  const current = new Set(parseSkillDisabled(toml));
  if (disabled) current.add(safe);
  else current.delete(safe);
  const rendered = [...current].sort().map((entry) => `"${entry}"`).join(', ');
  const line = `disabled = [${rendered}]`;
  if (/\[skills\]/.test(toml)) {
    if (/\[skills\][\s\S]*?disabled\s*=\s*\[[\s\S]*?\]/.test(toml)) {
      return toml.replace(/(\[skills\][\s\S]*?)disabled\s*=\s*\[[\s\S]*?\]/, `$1${line}`);
    }
    return toml.replace(/\[skills\]/, `[skills]\n${line}`);
  }
  const suffix = toml.endsWith('\n') || toml.length === 0 ? '' : '\n';
  return `${toml}${suffix}\n[skills]\n${line}\n`;
}
