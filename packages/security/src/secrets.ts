type MaskRule = {
  label: string;
  pattern: RegExp;
  /** Which capture group holds the secret; 0 means the whole match. */
  group?: number;
};

const RULES: MaskRule[] = [
  { label: 'private-key', pattern: /-----BEGIN[^-]{0,40}PRIVATE KEY-----[\s\S]*?-----END[^-]{0,40}PRIVATE KEY-----/g },
  { label: 'xai-key', pattern: /\bxai-[A-Za-z0-9_-]{12,}/g },
  { label: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { label: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/g },
  { label: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { label: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { label: 'google-key', pattern: /\bAIza[0-9A-Za-z_-]{20,}/g },
  { label: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{30,}/g },
  { label: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g },
  { label: 'bearer-token', pattern: /\b(?:Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{12,})/gi, group: 1 },
  { label: 'github-fine-grained', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { label: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{16,}/g },
  { label: 'stripe-key', pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { label: 'google-oauth', pattern: /\b(?:ya29|1\/\/)[A-Za-z0-9_-]{20,}/g },
  { label: 'slack-webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/+]{20,}/g },
  { label: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  {
    label: 'env-secret',
    // The `"?` catches the JSON spelling, where a quote sits between the key and
    // the colon: `"API_TOKEN": "…"`.
    pattern:
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|SESSION)[A-Z0-9_]*)"?\s*[:=]\s*["']?([^\s"';,]{4,})/g,
    group: 2,
  },
  {
    label: 'json-secret',
    // Same idea for lowercase and camelCase JSON keys. `session` is left out of
    // this one: lowercase `session:` shows up constantly in ordinary logs.
    pattern:
      /"([A-Za-z0-9_-]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|credential)[A-Za-z0-9_-]*)"\s*:\s*"([^"]{4,})"/gi,
    group: 2,
  },
];

const REDACTION = (label: string) => `[redacted:${label}]`;

/**
 * Replace anything that looks like a credential before it reaches the UI, the
 * session store, or a diagnostics log (spec 8.3).
 */
export function maskSecrets(input: string): string {
  if (!input) return input;
  let output = input;
  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    output = output.replace(pattern, (match, ...groups) => {
      if (!rule.group) return REDACTION(rule.label);
      const captured = groups[rule.group - 1];
      if (typeof captured !== 'string' || captured.length === 0) return match;
      return match.replace(captured, REDACTION(rule.label));
    });
  }
  return output;
}

/** True when masking would change the text, i.e. the text carries a secret. */
export function containsSecret(input: string): boolean {
  return maskSecrets(input) !== input;
}

/** Mask an object's string leaves; used for structured tool payloads. */
export function maskDeep<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === 'string') return maskSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = maskDeep(item, depth + 1);
    }
    return output as unknown as T;
  }
  return value;
}
