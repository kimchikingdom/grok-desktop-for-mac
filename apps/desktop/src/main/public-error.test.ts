import { describe, expect, it } from 'vitest';
import { publicIpcError } from './public-error.js';

describe('publicIpcError', () => {
  it('keeps short Korean errors', () => {
    expect(publicIpcError('이미 실행 중인 요청이 있습니다.')).toBe('이미 실행 중인 요청이 있습니다.');
    expect(publicIpcError('이 세션에는 워크트리가 없습니다.')).toBe('이 세션에는 워크트리가 없습니다.');
  });

  it('strips stacks and English internals', () => {
    expect(publicIpcError('ENOENT: no such file')).toBe('요청을 처리하지 못했습니다.');
    expect(publicIpcError('세션 실패\n    at foo')).toBe('요청을 처리하지 못했습니다.');
  });
});
