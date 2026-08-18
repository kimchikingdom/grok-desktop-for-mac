#!/usr/bin/env node
/**
 * A stand-in for `grok agent stdio`, used by the integration tests so the whole
 * ACP round trip can run without the real CLI or a network call.
 *
 * Usage: node fake-agent.mjs <scenario>
 *   basic       stream two message chunks and finish
 *   permission  ask for an edit approval, then write the file through the client
 *   noise       print junk on stdout before behaving like `basic`
 *   escape      try to read a file outside the workspace
 *   crash       exit abruptly in the middle of a turn
 *   load-fail   advertise session/load but reject the call
 */

const scenario = process.argv[2] ?? 'basic';

let nextId = 1000;
const pending = new Map();
let buffer = '';

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function chunk(sessionId, text) {
  notify('session/update', {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  });
}

async function handlePrompt(id, params) {
  const sessionId = params.sessionId;

  if (scenario === 'crash') {
    chunk(sessionId, '작업을 시작합니다.');
    setTimeout(() => process.exit(7), 20);
    return;
  }

  if (scenario === 'escape') {
    try {
      await request('fs/read_text_file', { sessionId, path: '../outside-secret.txt' });
      chunk(sessionId, '탈출 성공');
    } catch (error) {
      chunk(sessionId, `읽기 거부됨: ${error.message}`);
    }
    respond(id, { stopReason: 'end_turn' });
    return;
  }

  if (scenario === 'permission') {
    notify('session/update', {
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'README.md 수정',
        kind: 'edit',
        status: 'pending',
        locations: [{ path: 'README.md' }],
      },
    });

    const outcome = await request('session/request_permission', {
      sessionId,
      toolCall: {
        toolCallId: 'call-1',
        title: 'README.md 수정',
        kind: 'edit',
        locations: [{ path: 'README.md' }],
        content: [
          { type: 'diff', path: 'README.md', oldText: 'hello\n', newText: 'hello world\n' },
        ],
        rawInput: { path: 'README.md', description: '인사말을 바꿉니다.' },
      },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    });

    const approved =
      outcome?.outcome?.outcome === 'selected' && outcome.outcome.optionId.startsWith('allow');

    if (approved) {
      await request('fs/write_text_file', {
        sessionId,
        path: 'README.md',
        content: 'hello world\n',
      });
      notify('session/update', {
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call-1',
          status: 'completed',
        },
      });
      chunk(sessionId, 'README.md를 수정했습니다.');
    } else {
      notify('session/update', {
        sessionId,
        update: { sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'failed' },
      });
      chunk(sessionId, '사용자가 거부해서 변경하지 않았습니다.');
    }

    respond(id, { stopReason: 'end_turn' });
    return;
  }

  chunk(sessionId, '이 프로젝트는 ');
  chunk(sessionId, 'README.md 파일을 가지고 있습니다.');
  respond(id, { stopReason: 'end_turn' });
}

async function handleMessage(message) {
  if (message.id !== undefined && message.method === undefined) {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
    return;
  }

  switch (message.method) {
    case 'initialize':
      if (scenario === 'noise') process.stdout.write('grok cli banner: not json\n');
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: scenario !== 'no-load' },
        authMethods: [{ id: 'cached_token', name: 'Cached token' }],
      });
      return;
    case 'session/new':
      respond(message.id, { sessionId: 'fake-session-1' });
      return;
    case 'session/load': {
      if (scenario === 'load-fail' || message.params?.sessionId !== 'fake-session-1') {
        send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: 'unknown session' },
        });
        return;
      }
      respond(message.id, { sessionId: message.params.sessionId });
      return;
    }
    case 'session/prompt':
      await handlePrompt(message.id, message.params);
      return;
    case 'session/cancel':
      return;
    default:
      if (message.id !== undefined) {
        send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Unknown method ${message.method}` },
        });
      }
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  buffer += data;
  let index = buffer.indexOf('\n');
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) {
      try {
        void handleMessage(JSON.parse(line));
      } catch {
        // ignore malformed input from the client
      }
    }
    index = buffer.indexOf('\n');
  }
});

process.stdin.on('end', () => process.exit(0));
