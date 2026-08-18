import { describe, expect, it } from 'vitest';
import { extractLocalhostUrls, parseLocalhostUrl } from '@grok-desktop/shared';

describe('localhost preview urls', () => {
  it('keeps loopback http urls and drops everything else', () => {
    expect(parseLocalhostUrl('http://localhost:5173/app')).toBe('http://localhost:5173/app');
    expect(parseLocalhostUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/');
    expect(parseLocalhostUrl('https://example.com')).toBeNull();
    expect(parseLocalhostUrl('http://evil.localhost')).toBeNull();
    expect(parseLocalhostUrl('http://user:pass@localhost:80')).toBeNull();
  });

  it('extracts unique urls from command output', () => {
    const text = 'ready on http://localhost:3000\nopen http://localhost:3000/ and http://127.0.0.1:3000';
    expect(extractLocalhostUrls(text)).toEqual(['http://localhost:3000/', 'http://127.0.0.1:3000/']);
  });
});
