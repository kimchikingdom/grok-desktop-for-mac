import { describe, expect, it } from 'vitest';
import { parseSessionUpdate, requestPermissionParamsSchema } from './protocol.js';

describe('parseSessionUpdate', () => {
  it('reads an agent message chunk', () => {
    const update = parseSessionUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '안녕' },
    });
    expect(update).toEqual({ kind: 'agent-message', text: '안녕' });
  });

  it('separates thoughts from answers', () => {
    const update = parseSessionUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: '생각' },
    });
    expect(update.kind).toBe('agent-thought');
  });

  it('normalises tool calls and updates', () => {
    const created = parseSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Read src/index.ts',
      kind: 'read',
      status: 'pending',
      locations: [{ path: 'src/index.ts', line: 12 }],
    });
    expect(created).toMatchObject({ kind: 'tool-call', isUpdate: false });
    if (created.kind === 'tool-call') {
      expect(created.call.locations?.[0]).toEqual({ path: 'src/index.ts', line: 12 });
    }

    const updated = parseSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
    });
    expect(updated).toMatchObject({ kind: 'tool-call', isUpdate: true });
  });

  it('reads subagent and background-task updates', () => {
    const spawned = parseSessionUpdate({
      sessionUpdate: 'subagent_spawned',
      agentId: 'a1',
      title: 'explore',
    });
    expect(spawned).toMatchObject({ kind: 'subagent', phase: 'spawned', id: 'a1', title: 'explore' });
    const task = parseSessionUpdate({
      sessionUpdate: 'task_backgrounded',
      taskId: 't9',
      title: 'npm test',
    });
    expect(task).toMatchObject({ kind: 'task', phase: 'backgrounded', id: 't9' });
  });

  it('degrades unknown update kinds instead of throwing', () => {
    const update = parseSessionUpdate({ sessionUpdate: 'brand_new_thing', payload: 1 });
    expect(update.kind).toBe('unsupported');
  });

  it('degrades a tool call that is missing its id', () => {
    expect(parseSessionUpdate({ sessionUpdate: 'tool_call', title: 'x' }).kind).toBe('unsupported');
  });
});

describe('requestPermissionParamsSchema', () => {
  it('accepts an empty option list so the app can supply its own choices', () => {
    const result = requestPermissionParamsSchema.safeParse({
      sessionId: 's1',
      toolCall: { toolCallId: 't1' },
      options: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a well formed request', () => {
    const result = requestPermissionParamsSchema.safeParse({
      sessionId: 's1',
      toolCall: { toolCallId: 't1', kind: 'edit', title: 'edit' },
      options: [{ optionId: 'a', kind: 'allow_once', name: 'Allow' }],
    });
    expect(result.success).toBe(true);
  });
});
