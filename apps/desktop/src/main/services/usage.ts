import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sanitizeEnvironment } from '@grok-desktop/security';
import type { SessionUsageTotals } from '@grok-desktop/shared';

const execFileAsync = promisify(execFile);

/**
 * `grok usage <session-id>` prints what the CLI persisted for a session. It is
 * the only place the CLI reports real token counts — the ACP stream carries
 * none — so the header shows these numbers rather than an estimate.
 */
export function parseSessionUsage(stdout: string): SessionUsageTotals | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const root = parsed as Record<string, unknown>;
  const session = root.session;
  if (typeof session !== 'object' || session === null) return null;
  const totals = session as Record<string, unknown>;

  const count = (key: string): number => {
    const value = totals[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const totalTokens = count('totalTokens');
  const inputTokens = count('inputTokens');
  const outputTokens = count('outputTokens');
  if (totalTokens === 0 && inputTokens === 0 && outputTokens === 0) return null;

  const primaryModelId = typeof totals.primaryModelId === 'string' ? totals.primaryModelId : undefined;
  const updatedAt = typeof root.updatedAt === 'string' ? root.updatedAt : new Date().toISOString();
  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cachedReadTokens: count('cachedReadTokens'),
    reasoningTokens: count('reasoningTokens'),
    modelCalls: count('modelCalls'),
    turnCount: count('turnCount'),
    primaryModelId,
    updatedAt,
  };
}

/**
 * Reads persisted usage for one CLI session. Returns null whenever the CLI has
 * nothing recorded yet (a fresh session) or the command fails — the header then
 * keeps showing what it already had instead of a zero.
 */
export async function readSessionUsage(
  binaryPath: string,
  grokSessionId: string,
  grokHome?: string,
): Promise<SessionUsageTotals | null> {
  try {
    const env = sanitizeEnvironment(process.env);
    const { stdout } = await execFileAsync(binaryPath, ['usage', grokSessionId], {
      timeout: 5_000,
      env: grokHome ? { ...env, GROK_HOME: grokHome } : env,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseSessionUsage(stdout);
  } catch {
    return null;
  }
}
