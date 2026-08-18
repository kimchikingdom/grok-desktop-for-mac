import { describe, expect, it } from 'vitest';
import {
  ALL_IPC_CHANNELS,
  IpcChannels,
  ipcInputSchemas,
  permissionDecisionInput,
  promptInput,
  readFileInput,
  openSafeUrlInput,
} from '@grok-desktop/shared';
import { assertSafeExternalUrl, isSafeExternalUrl, sanitizeEnvironment } from '@grok-desktop/security';
import { publicIpcError } from '../../apps/desktop/src/main/public-error.js';

describe('IPC schemas', () => {
  it('has a schema for every invokable channel', () => {
    const invokable = ALL_IPC_CHANNELS.filter((channel) => channel !== IpcChannels.sessionEvent);
    for (const channel of invokable) {
      expect(Object.keys(ipcInputSchemas)).toContain(channel);
    }
  });

  it('rejects unknown keys so a renderer cannot smuggle extra fields', () => {
    const result = promptInput.safeParse({
      sessionId: 's1',
      text: 'hi',
      attachments: [],
      cwdOverride: '/etc',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a prompt without a session id', () => {
    expect(promptInput.safeParse({ text: 'hi' }).success).toBe(false);
  });

  it('accepts a side-ask flag without extra keys', () => {
    expect(
      promptInput.safeParse({
        sessionId: 's1',
        text: '이 함수가 뭐 해',
        attachments: [],
        sideAsk: true,
      }).success,
    ).toBe(true);
  });

  it('accepts a renderer client item id so rewind can find the bubble', () => {
    expect(
      promptInput.safeParse({
        sessionId: 's1',
        text: 'hi',
        attachments: [],
        clientItemId: 'local-3',
      }).success,
    ).toBe(true);
  });

  it('constrains the permission scope to the three allowed values', () => {
    expect(
      permissionDecisionInput.safeParse({
        sessionId: 's',
        requestId: 'r',
        optionId: 'o',
        scope: 'forever',
      }).success,
    ).toBe(false);
  });

  it('caps the file read size a renderer may request', () => {
    expect(
      readFileInput.safeParse({ workspaceId: 'w', relPath: 'a.txt', maxBytes: 999_999_999 }).success,
    ).toBe(false);
  });

  it('rejects non-URL strings for the external opener', () => {
    expect(openSafeUrlInput.safeParse({ url: 'not a url' }).success).toBe(false);
  });
});

describe('publicIpcError', () => {
  it('keeps short Korean errors and strips stacks', () => {
    expect(publicIpcError('이미 실행 중인 요청이 있습니다.')).toBe('이미 실행 중인 요청이 있습니다.');
    expect(publicIpcError('이 세션에는 워크트리가 없습니다.')).toBe('이 세션에는 워크트리가 없습니다.');
    expect(publicIpcError('ENOENT: no such file')).toBe('요청을 처리하지 못했습니다.');
    expect(publicIpcError('세션 실패\n    at foo')).toBe('요청을 처리하지 못했습니다.');
  });
});

describe('external URL policy', () => {
  it('allows only https on allow-listed hosts', () => {
    expect(isSafeExternalUrl('https://docs.x.ai/build/overview')).toBe(true);
    expect(isSafeExternalUrl('https://x.ai/cli')).toBe(true);
  });

  it('rejects dangerous schemes and unknown hosts', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'grok-desktop://run',
      'http://docs.x.ai',
      'https://evil.example/x.ai',
      'https://x.ai.evil.example',
      'https://user:pass@x.ai',
    ]) {
      expect(isSafeExternalUrl(url)).toBe(false);
      expect(() => assertSafeExternalUrl(url)).toThrow();
    }
  });
});

describe('child process environment', () => {
  it('drops credentials and injection vectors', () => {
    const env = sanitizeEnvironment({
      PATH: '/usr/bin',
      HOME: '/Users/tester',
      AWS_SECRET_ACCESS_KEY: 'secret',
      GITHUB_TOKEN: 'ghp_x',
      XAI_API_KEY: 'xai-secret',
      NODE_OPTIONS: '--require /tmp/evil.js',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.XAI_API_KEY).toBeUndefined();
  });

  it('forwards the API key only when explicitly requested', () => {
    const env = sanitizeEnvironment({ XAI_API_KEY: 'xai-secret' }, { includeApiKey: true });
    expect(env.XAI_API_KEY).toBe('xai-secret');
  });
});
