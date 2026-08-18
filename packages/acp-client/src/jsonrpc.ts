/**
 * Line-delimited JSON-RPC 2.0 over a pair of streams (spec 11.2).
 *
 * Design rules:
 * - one malformed line must never take the app down, it is reported and skipped
 * - every outgoing request has a timeout and can be settled exactly once
 * - when the transport dies, all pending requests reject with the same error
 */

export type JsonRpcId = string | number;

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }

  toObject(): JsonRpcErrorObject {
    return { code: this.code, message: this.message, data: this.data };
  }
}

export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** ACP-specific: the user rejected the operation. */
  authRequired: -32000,
} as const;

export type IncomingRequestHandler = (method: string, params: unknown) => Promise<unknown>;
export type IncomingNotificationHandler = (method: string, params: unknown) => void;

export type JsonRpcPeerOptions = {
  send: (line: string) => void;
  onRequest: IncomingRequestHandler;
  onNotification: IncomingNotificationHandler;
  onTransportError: (error: Error) => void;
  defaultTimeoutMs?: number;
  /** Guard against a runaway agent flooding a single line. */
  maxLineBytes?: number;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  method: string;
};

export class JsonRpcPeer {
  #nextId = 1;
  #pending = new Map<JsonRpcId, Pending>();
  #buffer = '';
  #closed = false;
  readonly #options: Required<Pick<JsonRpcPeerOptions, 'defaultTimeoutMs' | 'maxLineBytes'>> &
    JsonRpcPeerOptions;

  constructor(options: JsonRpcPeerOptions) {
    this.#options = {
      defaultTimeoutMs: 120_000,
      maxLineBytes: 32 * 1024 * 1024,
      ...options,
    };
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  /** Feed raw stdout data. Handles partial lines across chunks. */
  receive(chunk: string): void {
    if (this.#closed) return;
    this.#buffer += chunk;

    let newlineIndex = this.#buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.#buffer.slice(0, newlineIndex).trim();
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      if (line.length > this.#options.maxLineBytes) {
        this.#options.onTransportError(
          new Error(`Dropped an oversized JSON-RPC line (> ${this.#options.maxLineBytes} bytes)`),
        );
      } else if (line.length > 0) {
        this.#handleLine(line);
      }
      newlineIndex = this.#buffer.indexOf('\n');
    }

    if (this.#buffer.length > this.#options.maxLineBytes) {
      this.#buffer = '';
      this.#options.onTransportError(
        new Error(`Dropped an oversized JSON-RPC line (> ${this.#options.maxLineBytes} bytes)`),
      );
    }
  }

  #handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      // Non-JSON noise on stdout (banner, warning) is reported but not fatal.
      this.#options.onTransportError(new Error(`Ignored non-JSON line from agent: ${truncate(line)}`));
      return;
    }

    if (!isRecord(message)) {
      this.#options.onTransportError(new Error(`Ignored non-object JSON-RPC message: ${truncate(line)}`));
      return;
    }

    if ('method' in message && typeof message.method === 'string') {
      if ('id' in message && message.id !== null && message.id !== undefined) {
        void this.#dispatchRequest(message.id as JsonRpcId, message.method, message.params);
      } else {
        try {
          this.#options.onNotification(message.method, message.params);
        } catch (error) {
          this.#options.onTransportError(toError(error));
        }
      }
      return;
    }

    if ('id' in message && message.id !== null && message.id !== undefined) {
      this.#settle(message.id as JsonRpcId, message);
      return;
    }

    this.#options.onTransportError(new Error(`Unrecognised JSON-RPC message: ${truncate(line)}`));
  }

  async #dispatchRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.#options.onRequest(method, params);
      this.#write({ jsonrpc: '2.0', id, result: result ?? null });
    } catch (error) {
      const rpcError =
        error instanceof JsonRpcError
          ? error.toObject()
          : { code: JSON_RPC_ERRORS.internalError, message: toError(error).message };
      this.#write({ jsonrpc: '2.0', id, error: rpcError });
    }
  }

  #settle(id: JsonRpcId, message: Record<string, unknown>): void {
    const pending = this.#pending.get(id);
    if (!pending) {
      this.#options.onTransportError(new Error(`Response for unknown request id ${String(id)}`));
      return;
    }
    this.#pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);

    if ('error' in message && message.error) {
      const raw = message.error as Partial<JsonRpcErrorObject>;
      pending.reject(
        new JsonRpcError(
          typeof raw.code === 'number' ? raw.code : JSON_RPC_ERRORS.internalError,
          typeof raw.message === 'string' ? raw.message : `Request ${pending.method} failed`,
          raw.data,
        ),
      );
      return;
    }

    pending.resolve('result' in message ? message.result : null);
  }

  request<T = unknown>(
    method: string,
    params?: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    if (this.#closed) {
      return Promise.reject(new Error(`Cannot send ${method}: transport is closed`));
    }
    const id = this.#nextId++;
    const timeoutMs = options.timeoutMs ?? this.#options.defaultTimeoutMs;

    return new Promise<T>((resolve, reject) => {
      const pending: Pending = {
        resolve: resolve as (value: unknown) => void,
        reject,
        method,
      };
      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this.#pending.delete(id);
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${method}`));
        }, timeoutMs);
        pending.timer.unref?.();
      }
      this.#pending.set(id, pending);
      try {
        this.#write({ jsonrpc: '2.0', id, method, params: params ?? {} });
      } catch (error) {
        this.#pending.delete(id);
        if (pending.timer) clearTimeout(pending.timer);
        reject(toError(error));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.#closed) return;
    this.#write({ jsonrpc: '2.0', method, params: params ?? {} });
  }

  #write(message: unknown): void {
    this.#options.send(`${JSON.stringify(message)}\n`);
  }

  /** Reject every in-flight request; used when the child process exits. */
  close(reason: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const [id, pending] of this.#pending) {
      if (pending.timer) clearTimeout(pending.timer);
      this.#pending.delete(id);
      pending.reject(reason);
    }
    this.#buffer = '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function truncate(value: string, max = 200): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
