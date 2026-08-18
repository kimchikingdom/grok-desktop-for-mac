/** Renderer-facing IPC errors: keep short Korean copy, drop stacks and internals. */
export function publicIpcError(message: string): string {
  if (!message || message.includes('\n') || message.length > 300) {
    return '요청을 처리하지 못했습니다.';
  }
  if (/[가-힣]/.test(message)) return message;
  if (
    message.startsWith('Grok') ||
    message.startsWith('origin') ||
    message.startsWith('PR') ||
    message.startsWith('MCP') ||
    message.startsWith('Git')
  ) {
    return message;
  }
  return '요청을 처리하지 못했습니다.';
}
