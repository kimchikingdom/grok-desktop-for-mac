import { describe, expect, it, vi } from 'vitest';
import { JSON_RPC_ERRORS, JsonRpcError, JsonRpcPeer } from './jsonrpc.js';

function makePeer(overrides: Partial<ConstructorParameters<typeof JsonRpcPeer>[0]> = {}) {
  const sent: string[] = [];
  const errors: Error[] = [];
  const peer = new JsonRpcPeer({
    send: (line) => sent.push(line),
    onRequest: async () => ({ ok: true }),
    onNotification: () => undefined,
    onTransportError: (error) => errors.push(error),
    defaultTimeoutMs: 50,
    ...overrides,
  });
  return { peer, sent, errors };
}

const parse = (line: string) => JSON.parse(line) as Record<string, unknown>;

describe('JsonRpcPeer', () => {
  it('resolves a request when the matching response arrives', async () => {
    const { peer, sent } = makePeer();
    const promise = peer.request('initialize', { protocolVersion: 1 });
    const outgoing = parse(sent[0] ?? '');
    peer.receive(`${JSON.stringify({ jsonrpc: '2.0', id: outgoing.id, result: { ok: 1 } })}\n`);
    await expect(promise).resolves.toEqual({ ok: 1 });
  });

  it('rejects with the error object the peer sent', async () => {
    const { peer, sent } = makePeer();
    const promise = peer.request('session/prompt');
    const outgoing = parse(sent[0] ?? '');
    peer.receive(
      `${JSON.stringify({ jsonrpc: '2.0', id: outgoing.id, error: { code: -32000, message: 'auth required' } })}\n`,
    );
    await expect(promise).rejects.toThrow('auth required');
  });

  it('times out a request that is never answered', async () => {
    const { peer } = makePeer({ defaultTimeoutMs: 10 });
    await expect(peer.request('session/prompt')).rejects.toThrow(/Timed out/);
  });

  it('survives a malformed line and keeps processing the next one', () => {
    const notifications: string[] = [];
    const { peer, errors } = makePeer({
      onNotification: (method) => notifications.push(method),
    });
    peer.receive('this is not json\n');
    peer.receive(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {} })}\n`);
    expect(errors).toHaveLength(1);
    expect(notifications).toEqual(['session/update']);
  });

  it('reassembles messages split across chunks', () => {
    const notifications: unknown[] = [];
    const { peer } = makePeer({ onNotification: (_m, params) => notifications.push(params) });
    peer.receive('{"jsonrpc":"2.0","method":"session/update","par');
    peer.receive('ams":{"sessionId":"s1"}}\n');
    expect(notifications).toEqual([{ sessionId: 's1' }]);
  });

  it('answers incoming requests and reports handler failures as rpc errors', async () => {
    const { peer, sent } = makePeer({
      onRequest: async () => {
        throw new JsonRpcError(JSON_RPC_ERRORS.invalidParams, 'bad params');
      },
    });
    peer.receive(`${JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'fs/read_text_file', params: {} })}\n`);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const response = parse(sent[0] ?? '');
    expect(response.id).toBe(5);
    expect(response.error).toMatchObject({ code: JSON_RPC_ERRORS.invalidParams, message: 'bad params' });
  });

  it('rejects everything in flight when the transport closes', async () => {
    const { peer } = makePeer({ defaultTimeoutMs: 5_000 });
    const promise = peer.request('session/prompt');
    peer.close(new Error('agent exited'));
    await expect(promise).rejects.toThrow('agent exited');
    expect(peer.pendingCount).toBe(0);
  });

  it('drops an oversized line instead of buffering forever', () => {
    const { peer, errors } = makePeer({ maxLineBytes: 64 });
    peer.receive('x'.repeat(100));
    expect(errors[0]?.message).toMatch(/oversized/);
  });
});
