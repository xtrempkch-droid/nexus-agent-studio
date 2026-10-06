/**
 * Tests for LSP framing.
 *
 * Framing is the one place where a mistake silently corrupts every later
 * message, so these tests target the failure modes a real pipe produces: a
 * message split across reads (even mid-header), two messages in one read, and
 * a `Content-Length` that counts bytes rather than characters.
 *
 * @module common/lsp/framing.test
 */

import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { contentLengthOf, encodeLspMessage, LspFramer } from './framing.ts';

/** A framer plus the messages and errors it produced. */
function collector(): {
  readonly messages: unknown[];
  readonly errors: Error[];
  push: (chunk: Uint8Array) => void;
} {
  const messages: unknown[] = [];
  const errors: Error[] = [];
  const framer = new LspFramer({
    onMessage: (message) => messages.push(message),
    onError: (error) => errors.push(error),
  });
  return { messages, errors, push: (chunk) => framer.push(chunk) };
}

describe('encodeLspMessage', () => {
  it('writes a Content-Length header followed by the UTF-8 body', () => {
    const frame = encodeLspMessage({ jsonrpc: '2.0', id: 1, method: 'x' });
    const text = frame.toString('utf8');

    expect(text.startsWith('Content-Length: ')).toBe(true);
    expect(text).toContain('\r\n\r\n');
    const [header, body] = text.split('\r\n\r\n');
    expect(header).toBe(`Content-Length: ${Buffer.byteLength(body ?? '', 'utf8')}`);
    expect(JSON.parse(body ?? '{}')).toEqual({ jsonrpc: '2.0', id: 1, method: 'x' });
  });

  it('measures the body in bytes, not characters', () => {
    const message = { text: 'áéí' };
    const json = JSON.stringify(message);
    const bytes = Buffer.byteLength(json, 'utf8');
    // Guard the premise: the byte length really does differ from the character
    // count, otherwise this test would pass for the wrong reason.
    expect(bytes).toBeGreaterThan(json.length);

    const [header] = encodeLspMessage(message).toString('utf8').split('\r\n\r\n');
    expect(header).toBe(`Content-Length: ${bytes}`);
  });
});

describe('contentLengthOf', () => {
  it('reads the value case-insensitively', () => {
    expect(contentLengthOf('content-length: 42')).toBe(42);
    expect(contentLengthOf('Content-Length: 42')).toBe(42);
  });

  it('ignores other headers', () => {
    const header = 'Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: 7';
    expect(contentLengthOf(header)).toBe(7);
  });

  it('returns null when the header is absent or not a number', () => {
    expect(contentLengthOf('Content-Type: text/plain')).toBeNull();
    expect(contentLengthOf('Content-Length: abc')).toBeNull();
  });
});

describe('LspFramer', () => {
  it('decodes a complete frame in one push', () => {
    const sink = collector();
    sink.push(encodeLspMessage({ id: 1, result: 'ok' }));

    expect(sink.messages).toEqual([{ id: 1, result: 'ok' }]);
    expect(sink.errors).toEqual([]);
  });

  it('reassembles a frame split across many chunks, byte by byte', () => {
    const sink = collector();
    const frame = encodeLspMessage({ id: 7, result: { nested: 'valor' } });

    for (const byte of frame) {
      sink.push(Uint8Array.of(byte));
    }

    expect(sink.messages).toEqual([{ id: 7, result: { nested: 'valor' } }]);
  });

  it('decodes two frames delivered together', () => {
    const sink = collector();
    const combined = Buffer.concat([
      encodeLspMessage({ id: 1, result: 'a' }),
      encodeLspMessage({ id: 2, result: 'b' }),
    ]);
    sink.push(combined);

    expect(sink.messages).toEqual([
      { id: 1, result: 'a' },
      { id: 2, result: 'b' },
    ]);
  });

  it('waits for the whole body instead of emitting a partial message', () => {
    const sink = collector();
    const frame = encodeLspMessage({ id: 3, result: 'complete' });
    // Everything but the last body byte.
    sink.push(frame.subarray(0, frame.length - 1));
    expect(sink.messages).toEqual([]);

    sink.push(frame.subarray(frame.length - 1));
    expect(sink.messages).toEqual([{ id: 3, result: 'complete' }]);
  });

  it('tolerates a Content-Type header before Content-Length', () => {
    const sink = collector();
    const body = Buffer.from(JSON.stringify({ id: 9, result: true }), 'utf8');
    const header = Buffer.from(
      `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: ${body.length}\r\n\r\n`,
      'ascii',
    );
    sink.push(Buffer.concat([header, body]));

    expect(sink.messages).toEqual([{ id: 9, result: true }]);
  });

  it('reports a missing Content-Length as an error and stops', () => {
    const sink = collector();
    sink.push(Buffer.from('X-Other: 1\r\n\r\n{}', 'ascii'));

    expect(sink.errors).toHaveLength(1);
    expect(sink.errors[0]?.message).toContain('Content-Length');
    // A corrupted stream has no safe resumption point.
    sink.push(encodeLspMessage({ id: 1 }));
    expect(sink.messages).toEqual([]);
  });

  it('reports invalid JSON as an error', () => {
    const sink = collector();
    const body = Buffer.from('{not json', 'utf8');
    sink.push(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]));

    expect(sink.errors).toHaveLength(1);
    expect(sink.errors[0]?.message).toContain('JSON');
  });
});
