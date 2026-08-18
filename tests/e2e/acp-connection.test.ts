import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GrokAgentConnection,
  type AgentConnectionState,
  type ConnectionDelegate,
} from '@grok-desktop/acp-client';

const FAKE_AGENT = fileURLToPath(new URL('../fixtures/fake-agent.mjs', import.meta.url));

type Harness = {
  connection: GrokAgentConnection;
  messages: string[];
  states: AgentConnectionState[];
};

let workdir: string;
const open: GrokAgentConnection[] = [];

function makeConnection(scenario: string, overrides: Partial<ConnectionDelegate> = {}): Harness {
  const messages: string[] = [];
  const states: AgentConnectionState[] = [];

  const connection = new GrokAgentConnection({
    binaryPath: process.execPath,
    args: [FAKE_AGENT, scenario],
    cwd: workdir,
    startupTimeoutMs: 10_000,
    requestTimeoutMs: 10_000,
    delegate: {
      onSessionUpdate: (_sessionId, update) => {
        if (update.kind === 'agent-message') messages.push(update.text);
      },
      onRequestPermission: async () => ({ outcome: 'cancelled' }),
      readTextFile: async () => {
        throw new Error('작업공간 밖 경로입니다.');
      },
      writeTextFile: async () => undefined,
      onStderr: () => undefined,
      onStateChange: (state) => states.push(state),
      ...overrides,
    },
  });

  open.push(connection);
  return { connection, messages, states };
}

beforeEach(async () => {
  workdir = await mkdtemp(path.join(os.tmpdir(), 'grok-acp-'));
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((connection) => connection.dispose().catch(() => undefined)));
  await rm(workdir, { recursive: true, force: true });
});

describe('GrokAgentConnection against a fake ACP agent', () => {
  it('completes the handshake, creates a session and streams a reply', async () => {
    const { connection, messages, states } = makeConnection('basic');

    const initialize = await connection.start();
    expect(initialize.protocolVersion).toBe(1);
    expect(states).toContain('starting');
    expect(states).toContain('ready');

    const sessionId = await connection.newSession(workdir);
    expect(sessionId).toBe('fake-session-1');
    expect(connection.supportsLoadSession).toBe(true);

    const stopReason = await connection.prompt(sessionId, '이 프로젝트를 설명해줘');
    expect(stopReason).toBe('end_turn');
    expect(messages.join('')).toContain('README.md');
  });

  it('ignores non-JSON banner output on stdout', async () => {
    const { connection, messages } = makeConnection('noise');
    await connection.start();
    const sessionId = await connection.newSession(workdir);
    await connection.prompt(sessionId, '안녕');
    expect(messages.join('')).toContain('README.md');
  });

  it('surfaces a client-side denial to the agent as a JSON-RPC error', async () => {
    const { connection, messages } = makeConnection('escape');
    await connection.start();
    const sessionId = await connection.newSession(workdir);
    await connection.prompt(sessionId, '../outside-secret.txt 읽어줘');
    expect(messages.join('')).toContain('읽기 거부됨');
    expect(messages.join('')).not.toContain('탈출 성공');
  });

  it('rejects the pending request and reports failure when the agent dies mid-turn', async () => {
    const { connection, states } = makeConnection('crash');
    await connection.start();
    const sessionId = await connection.newSession(workdir);
    await expect(connection.prompt(sessionId, '작업해줘')).rejects.toThrow();
    expect(states).toContain('failed');
  });

  it('loads an existing session when the agent advertises the capability', async () => {
    const { connection } = makeConnection('basic');
    await connection.start();
    expect(connection.supportsLoadSession).toBe(true);
    await expect(connection.loadSession('fake-session-1', workdir)).resolves.toBe('fake-session-1');
  });

  it('surfaces a session/load failure from the agent', async () => {
    const { connection } = makeConnection('load-fail');
    await connection.start();
    await expect(connection.loadSession('fake-session-1', workdir)).rejects.toThrow();
  });

  it('leaves no child process behind after dispose', async () => {
    const { connection } = makeConnection('basic');
    await connection.start();
    const pid = connection.pid;
    expect(pid).toBeGreaterThan(0);

    await connection.dispose();
    expect(connection.state).toBe('stopped');
    expect(() => process.kill(pid as number, 0)).toThrow();
  });
});
