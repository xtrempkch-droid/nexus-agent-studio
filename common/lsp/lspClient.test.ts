/**
 * Tests for the LSP JSON-RPC client.
 *
 * A fake transport stands in for a language server, so the tests assert the
 * client's protocol discipline — matching replies by id, surfacing errors,
 * timing out, answering server-initiated requests, and rejecting on close —
 * without spawning anything.
 *
 * @module common/lsp/lspClient.test
 */

import { describe, expect, it } from 'vitest';
import { LspClient, LspRequestError, type LspTransport } from './lspClient.ts';

interface FakeTransport extends LspTransport {
  readonly sent: unknown[];
  deliver(message: unknown): void;
  emitClose(): void;
}

function fakeTransport(): FakeTransport {
  const sent: unknown[] = [];
  const messageListeners = new Set<(message: unknown) => void>();
  const closeListeners = new Set<() => void>();
  return {
    sent,
    send: (message) => {
      sent.push(message);
    },
    onMessage: (listener) => {
      messageListeners.add(listener);
    },
    onClose: (listener) => {
      closeListeners.add(listener);
    },
    close: () => {
      for (const listener of closeListeners) {
        listener();
      }
    },
    deliver: (message) => {
      for (const listener of messageListeners) {
        listener(message);
      }
    },
    emitClose: () => {
      for (const listener of closeListeners) {
        listener();
      }
    },
  };
}

describe('LspClient.request', () => {
  it('resolves the reply that matches the request id', async () => {
    const transport = fakeTransport();
    const client = new LspClient({ transport });

    const pending = client.request('initialize', { a: 1 });
    const sent = transport.sent[0] as { id: number; method: string };
    expect(sent.method).toBe('initialize');
    transport.deliver({ jsonrpc: '2.0', id: sent.id, result: { ok: true } });

    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('rejects with the server error, preserving the code', async () => {
    const transport = fakeTransport();
    const client = new LspClient({ transport });

    const pending = client.request('nope');
    const sent = transport.sent[0] as { id: number };
    transport.deliver({
      jsonrpc: '2.0',
      id: sent.id,
      error: { code: -32601, message: 'Method not found' },
    });

    await expect(pending).rejects.toThrow(/Method not found/);
    await pending.catch((error: LspRequestError) => {
      expect(error.code).toBe(-32601);
    });
  });

  it('times out when no reply arrives', async () => {
    const transport = fakeTransport();
    const client = new LspClient({ transport });

    await expect(client.request('slow', undefined, 20)).rejects.toThrow(/did not answer/);
  });

  it('rejects on close while a request is pending', async () => {
    const transport = fakeTransport();
    const client = new LspClient({ transport });

    const pending = client.request('initialize');
    transport.emitClose();

    await expect(pending).rejects.toThrow(/closed before answering/);
    expect(client.isClosed).toBe(true);
  });
});

describe('LspClient.notify', () => {
  it('sends a message without an id', () => {
    const transport = fakeTransport();
    const client = new LspClient({ transport });

    client.notify('initialized', {});

    expect(transport.sent[0]).toEqual({ jsonrpc: '2.0', method: 'initialized', params: {} });
  });

  it('throws once the client is closed', () => {
    const transport = fakeTransport();
    const client = new LspClient({ transport });
    client.dispose();

    expect(() => client.notify('x')).toThrow(LspRequestError);
  });
});

describe('LspClient notifications', () => {
  it('delivers server notifications to subscribers and honours unsubscribe', () => {
    const transport = fakeTransport();
    const client = new LspClient({ transport });
    const received: unknown[] = [];

    const unsubscribe = client.onNotification('textDocument/publishDiagnostics', (params) => {
      received.push(params);
    });

    transport.deliver({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'a' } });
    unsubscribe();
    transport.deliver({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'b' } });

    expect(received).toEqual([{ uri: 'a' }]);
  });

  it('answers a server-initiated request with Method not found instead of hanging', () => {
    const transport = fakeTransport();
    // Constructing the client is what registers the message listener; the
    // server's request is then answered through it.
    new LspClient({ transport });

    transport.deliver({ jsonrpc: '2.0', id: 5, method: 'workspace/configuration', params: {} });

    expect(transport.sent[0]).toEqual({
      jsonrpc: '2.0',
      id: 5,
      error: { code: -32601, message: 'unsupported request: workspace/configuration' },
    });
  });
});

describe('LspClient.initialize', () => {
  it('sends initialize then the initialized notification', async () => {
    const transport = fakeTransport();
    const client = new LspClient({ transport });

    const pending = client.initialize({ rootPath: '/ws' });
    const sent = transport.sent[0] as { id: number; params: { rootUri: string } };
    expect(sent.params.rootUri).toBe('file:///ws');

    transport.deliver({ jsonrpc: '2.0', id: sent.id, result: { capabilities: {} } });
    await pending;

    expect(transport.sent[1]).toEqual({ jsonrpc: '2.0', method: 'initialized', params: {} });
  });
});
