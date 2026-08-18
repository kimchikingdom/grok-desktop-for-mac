import { describe, expect, it } from 'vitest';
import { resolveComposerAction, type ComposerKeyState } from './composer-keys.js';

const press = (overrides: Partial<ComposerKeyState> = {}) =>
  resolveComposerAction({
    key: 'Enter',
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    isComposing: false,
    busy: false,
    ...overrides,
  });

describe('resolveComposerAction', () => {
  it('sends on a plain Enter', () => {
    expect(press()).toBe('send');
  });

  it('inserts a line break on Shift+Enter', () => {
    expect(press({ shiftKey: true })).toBe('newline');
    expect(press({ shiftKey: true, busy: true })).toBe('newline');
  });

  it('queues on Cmd/Ctrl+Enter while the agent is busy', () => {
    expect(press({ metaKey: true, busy: true })).toBe('queue');
    expect(press({ ctrlKey: true, busy: true })).toBe('queue');
  });

  it('sends on Cmd+Enter when nothing is running', () => {
    expect(press({ metaKey: true })).toBe('send');
  });

  it('queues a plain Enter while busy instead of failing to send', () => {
    expect(press({ busy: true })).toBe('queue');
  });

  it('never acts while an IME is composing a syllable', () => {
    expect(press({ isComposing: true })).toBe('ignore');
    expect(press({ isComposing: true, metaKey: true, busy: true })).toBe('ignore');
  });

  it('ignores other keys', () => {
    expect(press({ key: 'a' })).toBe('ignore');
    expect(press({ key: 'Escape' })).toBe('ignore');
  });
});
