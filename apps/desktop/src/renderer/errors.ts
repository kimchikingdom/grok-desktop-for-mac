/**
 * Electron wraps a rejected `invoke` as
 * `Error invoking remote method 'diff:get': Error: <message>`.
 * The channel name means nothing to the person reading the toast, so the
 * wrapper is peeled off and only the message the main process wrote is shown.
 */
export function errorMessage(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).trim();
  const unwrapped = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(?:Uncaught\s+)?Error:\s*/, '')
    .trim();
  return unwrapped.length > 0 ? unwrapped : raw;
}
