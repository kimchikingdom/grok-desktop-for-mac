/**
 * External links are opened in the OS browser, never inside the app, and only
 * for hosts we ship links to (spec 8.3). `file:`, `javascript:` and custom
 * schemes are rejected outright.
 */
const ALLOWED_HOSTS = [
  'x.ai',
  'docs.x.ai',
  'grok.com',
  'accounts.x.ai',
  'console.x.ai',
  'status.x.ai',
];

export class UnsafeUrlError extends Error {
  constructor(readonly url: string, readonly reason: string) {
    super(`Refused to open URL: ${reason}`);
    this.name = 'UnsafeUrlError';
  }
}

export function isSafeExternalUrl(candidate: string, allowedHosts: string[] = ALLOWED_HOSTS): boolean {
  try {
    assertSafeExternalUrl(candidate, allowedHosts);
    return true;
  } catch {
    return false;
  }
}

export function assertSafeExternalUrl(candidate: string, allowedHosts: string[] = ALLOWED_HOSTS): URL {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new UnsafeUrlError(candidate, 'URL 형식이 아닙니다.');
  }

  if (url.protocol !== 'https:') {
    throw new UnsafeUrlError(candidate, `허용되지 않은 스킴입니다 (${url.protocol}).`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError(candidate, 'URL에 자격 증명이 포함되어 있습니다.');
  }

  const host = url.hostname.toLowerCase();
  const allowed = allowedHosts.some((entry) => host === entry || host === `www.${entry}`);
  if (!allowed) {
    throw new UnsafeUrlError(candidate, `허용 목록에 없는 호스트입니다 (${host}).`);
  }

  return url;
}

export const ALLOWED_EXTERNAL_HOSTS = ALLOWED_HOSTS;
