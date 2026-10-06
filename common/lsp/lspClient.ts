/**
 * A small LSP client: requests, notifications and server-initiated messages.
 *
 * The client is deliberately **transport-agnostic**. It speaks JSON-RPC in terms
 * of a {@link LspTransport} (an object that sends values and reports them as they
 * arrive), so the protocol logic can be tested against an in-memory transport
 * without spawning a language server. {@link ./stdioTransport.ts} provides the
 * Node implementation that frames messages over a child process's stdio.
 *
 * Only the parts of the protocol this project uses are implemented: `initialize`
 * / `initialized`, document sync notifications, and `publishDiagnostics` (the
 * caller subscribes to it as a notification). A server-initiated **request** is
 * answered with `Method not found` rather than left hanging, because a server
 * that blocks on a request it never gets an answer to stops working.
 *
 * @module common/lsp/lspClient
 */

import { pathToFileURL } from 'node:url';

/** Raised when a request fails, times out, or the transport closes under it. */
export class LspRequestError extends Error {
  public override readonly name = 'LspRequestError';

  public constructor(
    message: string,
    /** JSON-RPC error code when the server rejected the request. */
    public readonly code?: number,
  ) {
    super(message);
  }
}

/** The transport surface {@link LspClient} needs, implemented by stdio or a test. */
export interface LspTransport {
  /** Send one already-structured message (the transport frames it). */
  send(message: unknown): void;
  /** Subscribe to inbound messages. */
  onMessage(listener: (message: unknown) => void): void;
  /** Subscribe to transport close; every pending request is rejected. */
  onClose(listener: () => void): void;
  /** Close the transport. */
  close(): void;
}

/** JSON-RPC error for a method a server sent that the client cannot handle. */
const METHOD_NOT_FOUND = -32601;

/** Options for {@link LspClient}. */
export interface LspClientOptions {
  readonly transport: LspTransport;
  /** Default per-request timeout in milliseconds. Defaults to 30000. */
  readonly timeoutMs?: number;
}

/** The `initialize` parameters this client fills in. */
export interface InitializeOptions {
  /** Absolute workspace root, sent as `rootUri`. */
  readonly rootPath: string;
  /** Client name reported in `clientInfo`. */
  readonly clientName?: string;
  readonly clientVersion?: string;
  /** Client capabilities; defaults to `{}` (nothing advertised). */
  readonly capabilities?: unknown;
  readonly initializationOptions?: unknown;
  readonly timeoutMs?: number;
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * JSON-RPC client for a language server.
 */
export class LspClient {
  private readonly transport: LspTransport;
  private readonly defaultTimeoutMs: number;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  private readonly closeHandlers = new Set<() => void>();
  private nextId = 1;
  private closed = false;

  public constructor(options: LspClientOptions) {
    this.transport = options.transport;
    this.defaultTimeoutMs = options.timeoutMs ?? 30_000;

    this.transport.onMessage((message) => this.handleMessage(message));
    this.transport.onClose(() => this.handleClose());
  }

  /** Whether the client has been closed (locally or by the transport). */
  public get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Send a request and await its result.
   *
   * @throws {@link LspRequestError} on a JSON-RPC error, a timeout, or a closed
   * transport.
   */
  public request(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new LspRequestError(`cannot send "${method}": the client is closed`));
    }

    const id = this.nextId;
    this.nextId += 1;
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<unknown>((resolve, reject) => {
      const timer =
        timeout > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new LspRequestError(`"${method}" did not answer within ${timeout} ms`));
            }, timeout)
          : undefined;
      // Do not keep the event loop alive just for a timeout.
      timer?.unref?.();

      this.pending.set(id, { method, resolve, reject, timer });
      this.transport.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  /** Send a notification (no reply expected). */
  public notify(method: string, params?: unknown): void {
    if (this.closed) {
      throw new LspRequestError(`cannot send "${method}": the client is closed`);
    }
    this.transport.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  /**
   * Subscribe to a server notification (e.g. `textDocument/publishDiagnostics`).
   *
   * @returns An unsubscribe function.
   */
  public onNotification(method: string, handler: (params: unknown) => void): () => void {
    const handlers = this.notificationHandlers.get(method) ?? new Set();
    handlers.add(handler);
    this.notificationHandlers.set(method, handlers);
    return () => {
      handlers.delete(handler);
    };
  }

  /**
   * Run the `initialize` handshake, then send `initialized`.
   *
   * @returns The server's `InitializeResult`.
   */
  public async initialize(options: InitializeOptions): Promise<unknown> {
    const result = await this.request(
      'initialize',
      {
        processId: process.pid,
        rootUri: pathToUri(options.rootPath),
        capabilities: options.capabilities ?? {},
        clientInfo: {
          name: options.clientName ?? 'nexus-agent-studio',
          version: options.clientVersion ?? '0.1.0',
        },
        ...(options.initializationOptions === undefined
          ? {}
          : { initializationOptions: options.initializationOptions }),
      },
      options.timeoutMs,
    );

    // The spec requires the client to confirm with `initialized` before sending
    // requests that depend on the negotiated capabilities.
    this.notify('initialized', {});
    return result;
  }

  /** Close the client: reject pending requests and close the transport. */
  public dispose(): void {
    this.handleClose();
  }

  private handleMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) {
      return;
    }
    const record = message as Record<string, unknown>;

    const hasId = typeof record['id'] === 'number';
    const method = typeof record['method'] === 'string' ? record['method'] : undefined;

    if (hasId && method !== undefined) {
      // A server -> client request. This client implements none, so it answers
      // with an error instead of leaving the server waiting.
      this.transport.send({
        jsonrpc: '2.0',
        id: record['id'],
        error: { code: METHOD_NOT_FOUND, message: `unsupported request: ${method}` },
      });
      return;
    }

    if (hasId) {
      const id = record['id'] as number;
      const pending = this.pending.get(id);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(id);
      if (pending.timer !== undefined) {
        clearTimeout(pending.timer);
      }

      const error = record['error'];
      if (error !== undefined) {
        const code =
          typeof (error as Record<string, unknown>)['code'] === 'number'
            ? ((error as Record<string, unknown>)['code'] as number)
            : undefined;
        const text =
          typeof (error as Record<string, unknown>)['message'] === 'string'
            ? ((error as Record<string, unknown>)['message'] as string)
            : 'the server returned an error';
        pending.reject(new LspRequestError(`${pending.method} failed: ${text}`, code));
        return;
      }
      pending.resolve(record['result']);
      return;
    }

    if (method !== undefined) {
      for (const handler of this.notificationHandlers.get(method) ?? []) {
        handler(record['params']);
      }
    }
  }

  private handleClose(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;

    for (const [id, pending] of this.pending) {
      if (pending.timer !== undefined) {
        clearTimeout(pending.timer);
      }
      pending.reject(new LspRequestError(`the language server closed before answering "${pending.method}"`));
      this.pending.delete(id);
    }

    try {
      this.transport.close();
    } catch {
      // Closing an already-closed transport is not an error worth surfacing.
    }
    for (const handler of this.closeHandlers) {
      handler();
    }
  }

  /** Subscribe to close (transport died or {@link dispose} was called). */
  public onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }
}

/** Convert an absolute filesystem path to a `file://` URI. */
function pathToUri(path: string): string {
  return pathToFileURL(path).href;
}
