import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { sanitizeEnvironment } from '@grok-desktop/security';
import { JSON_RPC_ERRORS, JsonRpcError, JsonRpcPeer } from './jsonrpc.js';
import {
  AcpMethods,
  PROTOCOL_VERSION,
  initializeResultSchema,
  newSessionResultSchema,
  parseSessionUpdate,
  promptResultSchema,
  readTextFileParamsSchema,
  requestPermissionParamsSchema,
  sessionNotificationSchema,
  writeTextFileParamsSchema,
  type AcpModelState,
  type AcpSessionUpdate,
  type InitializeResult,
  type RequestPermissionParams,
} from './protocol.js';

export type AgentConnectionState = 'stopped' | 'starting' | 'ready' | 'failed';

export type PermissionOutcome =
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'cancelled' };

/**
 * Callbacks the host (Electron main) must provide. Note that filesystem access
 * is routed back through the host on purpose: it lets the app enforce workspace
 * containment on every read and write the agent performs (spec 7.3).
 */
export type ConnectionDelegate = {
  onSessionUpdate: (sessionId: string, update: AcpSessionUpdate) => void;
  onRequestPermission: (params: RequestPermissionParams) => Promise<PermissionOutcome>;
  readTextFile: (params: {
    sessionId: string;
    path: string;
    line?: number;
    limit?: number;
  }) => Promise<string>;
  writeTextFile: (params: { sessionId: string; path: string; content: string }) => Promise<void>;
  onStderr: (line: string) => void;
  onStateChange: (state: AgentConnectionState, detail?: string) => void;
};

export type ConnectionOptions = {
  binaryPath: string;
  cwd: string;
  args?: string[];
  /** Model id passed as `-m`; the agent picks its default when omitted. */
  model?: string;
  /** Official CLI sandbox profile, placed before `agent`. */
  sandbox?: 'off' | 'workspace' | 'read-only' | 'strict';
  env?: NodeJS.ProcessEnv;
  includeApiKey?: boolean;
  delegate: ConnectionDelegate;
  /** Lets the host record the pid so a crashed app can clean up next launch. */
  onSpawn?: (pid: number) => void;
  onExit?: (pid: number) => void;
  /** Overridable so tests can drive a fake agent quickly. */
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
};

const DEFAULT_ARGS = ['agent', 'stdio'];

/** Longest stderr line kept, and the cap on an unterminated one. */
const MAX_STDERR_LINE_CHARS = 8_000;

export type TryRequestResult =
  | { ok: true; value: unknown }
  | { ok: false; code?: number; message: string };

/**
 * `--model` belongs to `grok agent`, not to its `stdio` subcommand, so it has
 * to be inserted before the subcommand: `grok agent -m <id> stdio`. Appending
 * it makes the CLI exit with "unexpected argument '-m'" (exit code 2).
 */
export function buildArgs(
  options: Pick<ConnectionOptions, 'args' | 'model' | 'sandbox'>,
): string[] {
  const base = options.args ?? DEFAULT_ARGS;
  let next = base;
  if (options.model) {
    const subcommandIndex = next.findIndex((arg) => arg === 'stdio');
    next =
      subcommandIndex === -1
        ? [...next, '-m', options.model]
        : [...next.slice(0, subcommandIndex), '-m', options.model, ...next.slice(subcommandIndex)];
  }
  if (options.sandbox && options.sandbox !== 'off' && !options.args) {
    next = ['--sandbox', options.sandbox, ...next];
  }
  return next;
}

export class GrokAgentConnection extends EventEmitter {
  #child: ChildProcessWithoutNullStreams | null = null;
  #peer: JsonRpcPeer | null = null;
  #state: AgentConnectionState = 'stopped';
  #stderrTail: string[] = [];
  #stderrBuffer = '';
  #exitReason: string | null = null;
  #supportsLoadSession = false;
  #disposing = false;
  #modelState: AcpModelState | null = null;
  readonly #options: ConnectionOptions;

  constructor(options: ConnectionOptions) {
    super();
    this.#options = options;
  }

  get state(): AgentConnectionState {
    return this.#state;
  }

  get stderrTail(): string {
    return this.#stderrTail.join('\n');
  }

  get pid(): number | undefined {
    return this.#child?.pid;
  }

  get supportsLoadSession(): boolean {
    return this.#supportsLoadSession;
  }

  /** Model catalogue reported by the agent during `initialize`. */
  get modelState(): AcpModelState | null {
    return this.#modelState;
  }

  #setState(state: AgentConnectionState, detail?: string): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#options.delegate.onStateChange(state, detail);
  }

  /** Spawn the CLI and complete the ACP handshake. */
  async start(): Promise<InitializeResult> {
    if (this.#child) throw new Error('Agent connection already started');
    this.#setState('starting');

    const child = spawn(this.#options.binaryPath, buildArgs(this.#options), {
      cwd: this.#options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: sanitizeEnvironment(this.#options.env ?? process.env, {
        includeApiKey: this.#options.includeApiKey ?? false,
      }),
      // Own process group so a cancel/quit can take down descendants too.
      detached: process.platform !== 'win32',
    }) as ChildProcessWithoutNullStreams;

    this.#child = child;
    if (child.pid !== undefined) this.#options.onSpawn?.(child.pid);

    const peer = new JsonRpcPeer({
      send: (line) => {
        if (child.stdin.writable) child.stdin.write(line);
      },
      onRequest: (method, params) => this.#handleAgentRequest(method, params),
      onNotification: (method, params) => this.#handleAgentNotification(method, params),
      onTransportError: (error) => this.emit('transport-error', error),
      defaultTimeoutMs: this.#options.requestTimeoutMs ?? 180_000,
    });
    this.#peer = peer;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => peer.receive(chunk));

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => this.#handleStderr(chunk));

    child.on('error', (error) => {
      this.#exitReason = error.message;
      this.#setState('failed', error.message);
      peer.close(error);
    });

    child.on('exit', (code, signal) => {
      if (child.pid !== undefined) this.#options.onExit?.(child.pid);
      const detail =
        this.#exitReason ??
        `Grok CLI가 종료되었습니다 (code=${code ?? 'null'}, signal=${signal ?? 'none'}).`;
      this.#child = null;
      peer.close(new Error(detail));
      // A shutdown we asked for is not a crash, even though it exits on SIGTERM.
      const clean = this.#disposing || (code === 0 && signal === null);
      this.#setState(clean ? 'stopped' : 'failed', clean ? undefined : detail);
      this.emit('exit', { code, signal, detail, intentional: this.#disposing });
    });

    const startupTimeout = this.#options.startupTimeoutMs ?? 30_000;
    const result = await peer
      .request<unknown>(
        AcpMethods.initialize,
        {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: false,
          },
        },
        { timeoutMs: startupTimeout },
      )
      .catch((error: Error) => {
        this.#setState('failed', error.message);
        throw error;
      });

    const parsed = initializeResultSchema.safeParse(result);
    if (!parsed.success) {
      const detail = 'initialize 응답을 해석할 수 없습니다. 지원되지 않는 CLI 버전일 수 있습니다.';
      this.#setState('failed', detail);
      throw new Error(detail);
    }

    this.#supportsLoadSession = parsed.data.agentCapabilities?.loadSession === true;
    this.#modelState = parsed.data._meta?.modelState ?? null;
    this.#setState('ready');
    return parsed.data;
  }

  async authenticate(methodId: string): Promise<void> {
    await this.#requirePeer().request(AcpMethods.authenticate, { methodId });
  }

  async newSession(cwd: string): Promise<string> {
    const raw = await this.#requirePeer().request(AcpMethods.newSession, {
      cwd,
      mcpServers: [],
    });
    const parsed = newSessionResultSchema.safeParse(raw);
    if (!parsed.success) throw new Error('session/new 응답에 sessionId가 없습니다.');
    return parsed.data.sessionId;
  }

  /**
   * Reattach to a Grok session the CLI still knows about (ACP `session/load`).
   * Callers must check `supportsLoadSession` first; a missing method becomes
   * a JSON-RPC error and the host falls back to `session/new`.
   */
  async loadSession(sessionId: string, cwd: string): Promise<string> {
    const raw = await this.#requirePeer().request(AcpMethods.loadSession, {
      sessionId,
      cwd,
      mcpServers: [],
    });
    const parsed = newSessionResultSchema.safeParse(raw);
    return parsed.success ? parsed.data.sessionId : sessionId;
  }

  async prompt(
    sessionId: string,
    prompt: string | Array<{ type: 'text'; text: string } | { type: 'image'; mimeType?: string; data?: string }>,
  ): Promise<string> {
    const blocks = typeof prompt === 'string' ? [{ type: 'text' as const, text: prompt }] : prompt;
    // No client-side timeout: a turn runs until the agent answers, and the user
    // sitting on an approval card is a normal part of that. Cancellation is
    // explicit (session/cancel) and a dead child is caught by the exit handler.
    const raw = await this.#requirePeer().request(
      AcpMethods.prompt,
      { sessionId, prompt: blocks },
      { timeoutMs: 0 },
    );
    const parsed = promptResultSchema.safeParse(raw);
    return parsed.success ? (parsed.data.stopReason ?? 'end_turn') : 'end_turn';
  }

  cancel(sessionId: string): void {
    this.#peer?.notify(AcpMethods.cancel, { sessionId });
  }

  /**
   * Official extension call. Callers must check `ok` before changing UI
   * state — a missing method is a failure, not a silent no-op.
   */
  async tryRequest(method: string, params: Record<string, unknown>): Promise<TryRequestResult> {
    try {
      return { ok: true, value: await this.#requirePeer().request(method, params) };
    } catch (error) {
      if (error instanceof JsonRpcError) {
        return { ok: false, code: error.code, message: error.message };
      }
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  #requirePeer(): JsonRpcPeer {
    if (!this.#peer || this.#state === 'failed' || this.#state === 'stopped') {
      throw new Error('Grok 에이전트 연결이 준비되지 않았습니다.');
    }
    return this.#peer;
  }

  #handleStderr(chunk: string): void {
    this.#stderrBuffer += chunk;
    let index = this.#stderrBuffer.indexOf('\n');
    while (index !== -1) {
      const line = this.#stderrBuffer.slice(0, index);
      this.#stderrBuffer = this.#stderrBuffer.slice(index + 1);
      if (line.trim()) {
        const clipped = line.length > MAX_STDERR_LINE_CHARS ? `${line.slice(0, MAX_STDERR_LINE_CHARS)}…` : line;
        this.#stderrTail.push(clipped);
        if (this.#stderrTail.length > 50) this.#stderrTail.shift();
        this.#options.delegate.onStderr(clipped);
      }
      index = this.#stderrBuffer.indexOf('\n');
    }
    // A child that never emits a newline would otherwise grow this buffer without
    // limit, and everything in it is later run through the secret masker.
    if (this.#stderrBuffer.length > MAX_STDERR_LINE_CHARS) {
      this.#stderrBuffer = this.#stderrBuffer.slice(-MAX_STDERR_LINE_CHARS);
    }
  }

  #handleAgentNotification(method: string, params: unknown): void {
    if (method !== AcpMethods.update) return;
    const parsed = sessionNotificationSchema.safeParse(params);
    if (!parsed.success) {
      this.emit('transport-error', new Error(`잘못된 session/update 알림을 무시했습니다.`));
      return;
    }
    this.#options.delegate.onSessionUpdate(
      parsed.data.sessionId,
      parseSessionUpdate(parsed.data.update),
    );
  }

  async #handleAgentRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case AcpMethods.requestPermission: {
        const parsed = requestPermissionParamsSchema.safeParse(params);
        if (!parsed.success) {
          throw new JsonRpcError(JSON_RPC_ERRORS.invalidParams, 'Invalid permission request');
        }
        const outcome = await this.#options.delegate.onRequestPermission(parsed.data);
        return { outcome };
      }
      case AcpMethods.readTextFile: {
        const parsed = readTextFileParamsSchema.safeParse(params);
        if (!parsed.success) {
          throw new JsonRpcError(JSON_RPC_ERRORS.invalidParams, 'Invalid fs/read_text_file params');
        }
        const content = await this.#options.delegate.readTextFile(parsed.data);
        return { content };
      }
      case AcpMethods.writeTextFile: {
        const parsed = writeTextFileParamsSchema.safeParse(params);
        if (!parsed.success) {
          throw new JsonRpcError(JSON_RPC_ERRORS.invalidParams, 'Invalid fs/write_text_file params');
        }
        await this.#options.delegate.writeTextFile(parsed.data);
        return null;
      }
      default:
        throw new JsonRpcError(JSON_RPC_ERRORS.methodNotFound, `Unsupported client method: ${method}`);
    }
  }

  /** Terminate the CLI and every process it started. */
  async dispose(timeoutMs = 3_000): Promise<void> {
    this.#disposing = true;
    const child = this.#child;
    this.#peer?.close(new Error('연결이 종료되었습니다.'));
    this.#peer = null;
    if (!child) {
      this.#setState('stopped');
      return;
    }

    if (child.exitCode !== null || child.killed) {
      this.#child = null;
      this.#setState('stopped');
      return;
    }

    const exited = new Promise<void>((resolve) => {
      const finish = () => resolve();
      child.once('exit', finish);
      if (child.exitCode !== null) finish();
    });

    killProcessTree(child, 'SIGTERM');

    const timer = setTimeout(() => killProcessTree(child, 'SIGKILL'), timeoutMs);
    timer.unref?.();
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs + 500).unref?.();
      }),
    ]);
    clearTimeout(timer);
    this.#child = null;
    this.#setState('stopped');
  }
}

function killProcessTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.killed || child.pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      child.kill(signal);
    } else {
      // Negative pid targets the whole group created by `detached: true`.
      process.kill(-child.pid, signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process is already gone.
    }
  }
}
