/**
 * Node stdio transport for a language server.
 *
 * Spawns the server as a child process and wires its `stdout`/`stdin` through
 * {@link LspFramer}, so {@link LspClient} sees structured messages. `stderr` is
 * drained (and discarded) rather than inherited: leaving it unread would fill the
 * pipe buffer and block the server mid-conversation — the same reason the MCP
 * bridge drains its child's stderr.
 *
 * The transport is the only part that touches `node:child_process`, which keeps
 * the protocol logic testable without a real server.
 *
 * @module common/lsp/stdioTransport
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { encodeLspMessage, LspFramer } from './framing.ts';
import type { LspTransport } from './lspClient.ts';

/** Options for {@link createStdioTransport}. */
export interface StdioTransportOptions {
  /** Executable to launch, e.g. `typescript-language-server`. */
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  /** Extra environment, merged over the current process environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** Called on a transport-level error (spawn failure, framing error). */
  readonly onError?: (error: Error) => void;
}

/**
 * Create a transport backed by a child process speaking LSP over stdio.
 *
 * The process is spawned immediately. A spawn error is reported through
 * {@link StdioTransportOptions.onError} and by closing the transport, so a
 * missing language server surfaces as a rejected request rather than a hang.
 */
export function createStdioTransport(options: StdioTransportOptions): LspTransport {
  const messageListeners = new Set<(message: unknown) => void>();
  const closeListeners = new Set<() => void>();
  let closed = false;

  const reportError = (error: Error): void => {
    options.onError?.(error);
  };

  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    for (const listener of closeListeners) {
      listener();
    }
  };

  const framer = new LspFramer({
    onMessage: (message) => {
      for (const listener of messageListeners) {
        listener(message);
      }
    },
    onError: (error) => {
      reportError(error);
      finish();
    },
  });

  let child: ChildProcess;
  try {
    child = spawn(options.command, [...(options.args ?? [])], {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env },
    });
  } catch (error) {
    // `spawn` throws synchronously only for invalid arguments; the common
    // "command not found" path arrives as an async 'error' event below.
    const failure = error instanceof Error ? error : new Error(String(error));
    queueMicrotask(() => {
      reportError(failure);
      finish();
    });
    return {
      send: () => undefined,
      onMessage: () => undefined,
      onClose: () => undefined,
      close: () => undefined,
    };
  }

  child.stdout?.on('data', (chunk: Buffer) => framer.push(chunk));
  child.stderr?.on('data', () => {
    // Drained on purpose; see the module note.
  });
  child.on('error', (error) => {
    reportError(error);
    finish();
  });
  child.on('close', () => finish());

  return {
    send: (message) => {
      if (closed || child.stdin === null) {
        return;
      }
      child.stdin.write(encodeLspMessage(message));
    },
    onMessage: (listener) => {
      messageListeners.add(listener);
    },
    onClose: (listener) => {
      closeListeners.add(listener);
    },
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      try {
        child.stdin?.end();
        child.kill();
      } catch {
        // The child may already be gone; nothing to do.
      }
      for (const listener of closeListeners) {
        listener();
      }
    },
  };
}
