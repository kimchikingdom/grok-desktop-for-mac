export function extractLocalhostUrls(text: string): string[] {
  const found = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/[^\s"'<>]*)?/gi) ?? [];
  const unique: string[] = [];
  for (const raw of found) {
    const parsed = parseLocalhostUrl(raw);
    if (parsed && !unique.includes(parsed)) unique.push(parsed);
  }
  return unique;
}

export function parseLocalhostUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1') return null;
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  }
  return url.href;
}
