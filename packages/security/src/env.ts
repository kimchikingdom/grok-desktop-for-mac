/**
 * The Grok CLI child process only receives the variables it needs (spec 8.3).
 * Everything else — cloud tokens, CI secrets, NODE_OPTIONS injection vectors —
 * is dropped.
 */
const ALLOWED_KEYS = new Set([
  'PATH',
  'HOME',
  'GROK_HOME',
  'SHELL',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'TZ',
  'COLORTERM',
  // Windows essentials
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'SystemRoot',
  'SystemDrive',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
]);

const ALLOWED_PREFIXES = ['XDG_'];

export type SanitizeEnvOptions = {
  /** Forward XAI_API_KEY only when the user explicitly chose API-key auth. */
  includeApiKey?: boolean;
  /** Extra variables the app sets itself (never user-controlled). */
  extra?: Record<string, string>;
};

export function sanitizeEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  options: SanitizeEnvOptions = {},
): Record<string, string> {
  const output: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (ALLOWED_KEYS.has(key) || ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      output[key] = value;
    }
  }

  if (options.includeApiKey && source.XAI_API_KEY) {
    output.XAI_API_KEY = source.XAI_API_KEY;
  }

  // Keep the agent non-interactive and free of colour escape noise.
  output.NO_COLOR = '1';
  output.CI = '';

  return { ...output, ...(options.extra ?? {}) };
}
