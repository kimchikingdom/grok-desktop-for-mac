export type ComposerKeyState = {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  /** True while an IME (Korean, Japanese, …) is still composing a character. */
  isComposing: boolean;
  /** True while a turn is running or an approval card is open. */
  busy: boolean;
};

export type ComposerAction =
  | 'send'
  | 'queue'
  /** Let the textarea insert a line break itself. */
  | 'newline'
  /** Not an Enter press we care about. */
  | 'ignore';

/**
 * Enter sends, Shift+Enter breaks the line, Cmd/Ctrl+Enter queues the message
 * for after the current turn. While the agent is busy a plain Enter queues too,
 * because there is nothing to send it to yet.
 *
 * The IME check matters for Korean input: the Enter that confirms a composing
 * syllable must never be read as "send".
 */
export function resolveComposerAction(state: ComposerKeyState): ComposerAction {
  if (state.key !== 'Enter') return 'ignore';
  if (state.isComposing) return 'ignore';
  if (state.shiftKey) return 'newline';
  if (state.metaKey || state.ctrlKey) return state.busy ? 'queue' : 'send';
  return state.busy ? 'queue' : 'send';
}
