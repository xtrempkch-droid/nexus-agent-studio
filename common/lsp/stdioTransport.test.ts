/**
 * Tests for the stdio transport, driving a real child process.
 *
 * A tiny LSP server is run with `node -e`, so the whole path is exercised for
 * real: spawn, framing out, framing in, and the handshake. This is the
 * behavioural counterpart to the framing unit tests — it proves the pieces fit
 * together over an actual pipe, which is exactly where a framing bug would show.
 *
 * @module common/lsp/stdioTransport.test
 */

import { describe, expect, it } from 'vitest';
import { LspClient } from './lspClient.ts';
import { createStdioTransport } from './stdioTransport.ts';

/** A minimal LSP server: answers `initialize` and publishes one diagnostic per open. */
const SERVER_SCRIPT = `
const enc = (m) => { const b = Buffer.from(JSON.stringify(m), 'utf8'); return Buffer.concat([Buffer.from('Content-Length: ' + b.length + '\\r\\n\\r\\n', 'ascii'), b]); };
let buf = Buffer.alloc(0);
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const sep = buf.indexOf('\\r\\n\\r\\n');
    if (sep === -1) return;
    const header = buf.subarray(0, sep).toString('ascii');
    const match = /content-length:\\s*(\\d+)/i.exec(header);
    if (match === null) return;
    const len = parseInt(match[1], 10);
    const start = sep + 4;
    if (buf.length - start < len) return;
    const body = JSON.parse(buf.subarray(start, start + len).toString('utf8'));
    buf = buf.subarray(start + len);
    if (body.method === 'initialize') {
      process.stdout.write(enc({ jsonrpc: '2.0', id: body.id, result: { capabilities: { textDocumentSync: 1 } } }));
    } else if (body.method === 'textDocument/didOpen') {
      process.stdout.write(enc({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri: body.params.textDocument.uri, diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: 'from child' }] },
      }));
    }
  }
});
`;

describe('createStdioTransport', () => {
  it('completes a real LSP handshake with a child process', async () => {
    const transport = createStdioTransport({ command: process.execPath, args: ['-e', SERVER_SCRIPT] });
    const client = new LspClient({ transport, timeoutMs: 10_000 });

    try {
      const result = (await client.initialize({ rootPath: '/ws' })) as {
        capabilities?: { textDocumentSync?: number };
      };
      expect(result.capabilities?.textDocumentSync).toBe(1);
    } finally {
      client.dispose();
    }
  });

  it('receives a server notification over the pipe', async () => {
    const transport = createStdioTransport({ command: process.execPath, args: ['-e', SERVER_SCRIPT] });
    const client = new LspClient({ transport, timeoutMs: 10_000 });

    try {
      await client.initialize({ rootPath: '/ws' });

      const diagnostic = new Promise<unknown>((resolve) => {
        client.onNotification('textDocument/publishDiagnostics', (params) => resolve(params));
      });

      client.notify('textDocument/didOpen', {
        textDocument: { uri: 'file:///ws/a.ts', languageId: 'typescript', version: 1, text: 'x' },
      });

      await expect(diagnostic).resolves.toMatchObject({ uri: 'file:///ws/a.ts' });
    } finally {
      client.dispose();
    }
  });

  it('rejects the request when the command cannot be spawned', async () => {
    const errors: Error[] = [];
    const transport = createStdioTransport({
      command: 'nexus-definitely-not-a-real-binary',
      onError: (error) => errors.push(error),
    });
    const client = new LspClient({ transport, timeoutMs: 5_000 });

    await expect(client.initialize({ rootPath: '/ws' })).rejects.toThrow();
    expect(errors.length).toBeGreaterThan(0);
    client.dispose();
  });
});
