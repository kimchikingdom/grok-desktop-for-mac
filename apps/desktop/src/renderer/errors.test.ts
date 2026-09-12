import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors.js';

describe('errorMessage', () => {
  it('drops the Electron invoke wrapper and keeps the main-process message', () => {
    expect(errorMessage(new Error("Error invoking remote method 'diff:get': Error: 이 파일의 변경 내용을 찾을 수 없습니다.")))
      .toBe('이 파일의 변경 내용을 찾을 수 없습니다.');
  });

  it('leaves a plain message alone', () => {
    expect(errorMessage(new Error('세션을 찾을 수 없습니다.'))).toBe('세션을 찾을 수 없습니다.');
  });

  it('handles values that are not Errors', () => {
    expect(errorMessage('그냥 문자열')).toBe('그냥 문자열');
    expect(errorMessage(42)).toBe('42');
  });

  it('keeps the original when unwrapping would leave nothing', () => {
    expect(errorMessage(new Error('Error:'))).toBe('Error:');
  });
});
