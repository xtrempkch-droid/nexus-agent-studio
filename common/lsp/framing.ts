/**
 * LSP base-protocol framing.
 *
 * Every Language Server Protocol message travels as an HTTP-like header block
 * followed by a JSON-RPC body. The header block is ASCII, each field is
 * terminated by `\r\n`, and the mandatory `Content-Length` field gives the size
 * of the body **in bytes** (not characters). Two `\r\n` sequences separate the
 * header from the body.
 *
 * Verified against the official 3.17 specification ("Base Protocol"): the
 * `Content-Length` header is required, headers use HTTP semantics (so field
 * names are case-insensitive), and the body is UTF-8 JSON. `Content-Type` is
 * optional and defaults to `application/vscode-jsonrpc; charset=utf-8`.
 *
 * The reader is incremental on purpose: a pipe delivers arbitrary chunks, so a
 * message routinely arrives split across reads — sometimes in the middle of the
 * header, sometimes in the middle of a multi-byte character. `LspFramer` buffers
 * until a whole body is present before decoding, which is what makes byte-based
 * lengths safe.
 *
 * @module common/lsp/framing
 */

import { Buffer } from 'node:buffer';

/** Raised when a chunk cannot be framed as a legal LSP message. */
export class LspFramingError extends Error {
  public override readonly name = 'LspFramingError';
}

/** The `\r\n\r\n` sequence that ends the header block. */
const HEADER_SEPARATOR = Buffer.from('\r\n\r\n', 'ascii');

/**
 * Encode one message as a single LSP frame.
 *
 * @param message - Any JSON-serialisable JSON-RPC message.
 * @returns The header plus the UTF-8 body, ready to write to the stream.
 */
export function encodeLspMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
  return Buffer.concat([header, body]);
}

/**
 * Read the `Content-Length` value out of a raw header block.
 *
 * Field names are compared case-insensitively, matching HTTP semantics.
 *
 * @returns The declared byte length, or `null` when absent or not a number.
 */
export function contentLengthOf(headerBlock: string): number | null {
  for (const field of headerBlock.split('\r\n')) {
    const colon = field.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const name = field.slice(0, colon).trim().toLowerCase();
    if (name !== 'content-length') {
      continue;
    }
    const value = Number.parseInt(field.slice(colon + 1).trim(), 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  return null;
}

/** Callbacks the framer invokes as it decodes. */
export interface LspFramerOptions {
  /** Called once per fully decoded message, in arrival order. */
  readonly onMessage: (message: unknown) => void;
  /**
   * Called on an unrecoverable framing error. The framer stops after this and
   * does not attempt to resynchronise, because a corrupted stream has no safe
   * resumption point. When omitted, the error is thrown from {@link LspFramer.push}.
   */
  readonly onError?: (error: Error) => void;
}

/**
 * Incremental decoder for LSP frames.
 *
 * Feed it raw chunks; it emits one callback per complete message and keeps the
 * remainder buffered for the next chunk.
 */
export class LspFramer {
  private buffer: Buffer = Buffer.alloc(0);
  private failed = false;

  public constructor(private readonly options: LspFramerOptions) {}

  /**
   * Append a chunk and decode as many complete messages as it contains.
   *
   * @param chunk - The bytes just read from the stream.
   */
  public push(chunk: Uint8Array): void {
    if (this.failed) {
      return;
    }

    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = this.buffer.length === 0 ? incoming : Buffer.concat([this.buffer, incoming]);

    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd === -1) {
        return;
      }

      const headerBlock = this.buffer.subarray(0, headerEnd).toString('ascii');
      const length = contentLengthOf(headerBlock);
      if (length === null) {
        this.fail(
          new LspFramingError(`missing or invalid Content-Length: ${JSON.stringify(headerBlock)}`),
        );
        return;
      }

      const bodyStart = headerEnd + HEADER_SEPARATOR.length;
      // Wait for the whole body: a partial read is normal on a pipe.
      if (this.buffer.length - bodyStart < length) {
        return;
      }

      const body = this.buffer.subarray(bodyStart, bodyStart + length);
      this.buffer = this.buffer.subarray(bodyStart + length);

      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch (error) {
        this.fail(new LspFramingError(`body was not valid JSON: ${(error as Error).message}`));
        return;
      }

      this.options.onMessage(parsed);
    }
  }

  private fail(error: Error): void {
    this.failed = true;
    if (this.options.onError === undefined) {
      throw error;
    }
    this.options.onError(error);
  }
}
