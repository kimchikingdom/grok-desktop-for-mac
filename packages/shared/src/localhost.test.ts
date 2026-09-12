import { describe, expect, it } from 'vitest';
import { canFrameLocalhost, extractLocalhostUrls, parseLocalhostUrl } from './localhost.js';

describe('parseLocalhostUrl', () => {
  it('keeps loopback hosts', () => {
    expect(parseLocalhostUrl('http://localhost:5173/')).toBe('http://localhost:5173/');
    expect(parseLocalhostUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/');
    expect(parseLocalhostUrl('http://[::1]:3000')).toBe('http://[::1]:3000/');
  });

  it('rejects anything else', () => {
    expect(parseLocalhostUrl('http://example.com')).toBeNull();
    expect(parseLocalhostUrl('file:///etc/passwd')).toBeNull();
    expect(parseLocalhostUrl('http://user:pw@localhost:3000')).toBeNull();
  });
});

describe('extractLocalhostUrls', () => {
  it('picks the loopback URLs out of command output', () => {
    const urls = extractLocalhostUrls('ready at http://localhost:5173/ and http://[::1]:3000\nignore http://x.dev');
    expect(urls).toEqual(['http://localhost:5173/', 'http://[::1]:3000/']);
  });
});

describe('canFrameLocalhost', () => {
  it('allows the hosts a CSP source list can name', () => {
    expect(canFrameLocalhost('http://localhost:5173/')).toBe(true);
    expect(canFrameLocalhost('http://127.0.0.1:3000')).toBe(true);
  });

  it('refuses IPv6 loopback, which Chromium drops from frame-src', () => {
    expect(canFrameLocalhost('http://[::1]:3000')).toBe(false);
  });

  it('refuses non-loopback URLs outright', () => {
    expect(canFrameLocalhost('http://example.com')).toBe(false);
  });
});
