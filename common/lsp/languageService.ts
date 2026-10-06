/**
 * The bridge between a language server and the editor's diagnostics.
 *
 * It owns the document lifecycle (`didOpen` / `didChange` / `didClose`) and turns
 * every `textDocument/publishDiagnostics` notification into {@link InlineHint}s,
 * the same currency the compiler-error parser produces. That keeps the editor UI
 * ignorant of LSP: it reads hints from one store regardless of who produced them.
 *
 * Document synchronisation honours the sync kind the server negotiated in its
 * `InitializeResult` (`textDocumentSync`): full sync sends the whole new text,
 * incremental sync sends a single change that replaces the whole previous
 * document — valid for both, and correct without diffing on every keystroke.
 *
 * @module common/lsp/languageService
 */

import { pathToFileURL } from 'node:url';
import type { InlineHintManager } from '../debug/hints.ts';
import { toInlineHints, type LspPosition } from './diagnostics.ts';
import { LspClient, type InitializeOptions, type LspTransport } from './lspClient.ts';

/** Whether the server wants full (1) or incremental (2) document sync. */
export type SyncKind = 'full' | 'incremental';

/** Options for {@link LanguageService}. */
export interface LanguageServiceOptions {
  readonly transport: LspTransport;
  /** Absolute workspace root, used to confine diagnostics. */
  readonly workspaceRoot: string;
  /** Store the diagnostics are written to. */
  readonly hints: InlineHintManager;
  /** Hint source tag, e.g. `lsp:typescript`. Cleared per file as diagnostics change. */
  readonly source: string;
  /** Maps a workspace-relative path to an LSP language id. */
  readonly languageIdForPath?: (path: string) => string;
  /** Default per-request timeout. */
  readonly timeoutMs?: number;
}

interface OpenDocument {
  readonly version: number;
  readonly text: string;
}

/** Position just past the final character of `text`, for a full replace. */
export function endPositionOf(text: string): LspPosition {
  const lines = text.split('\n');
  const last = lines[lines.length - 1] ?? '';
  return { line: lines.length - 1, character: last.length };
}

/** Best-effort language id from a file extension. */
export function defaultLanguageId(path: string): string {
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
  const map: Readonly<Record<string, string>> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
  };
  return map[extension] ?? 'plaintext';
}

/**
 * Manage one language server session and its diagnostics.
 */
export class LanguageService {
  private readonly client: LspClient;
  private readonly workspaceRoot: string;
  private readonly hints: InlineHintManager;
  private readonly source: string;
  private readonly languageIdForPath: (path: string) => string;
  private readonly documents = new Map<string, OpenDocument>();
  private readonly hintIdsByUri = new Map<string, string[]>();
  private syncKind: SyncKind = 'full';
  private unsubscribeDiagnostics: (() => void) | undefined;

  public constructor(options: LanguageServiceOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.hints = options.hints;
    this.source = options.source;
    this.languageIdForPath = options.languageIdForPath ?? defaultLanguageId;
    this.client = new LspClient({
      transport: options.transport,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  }

  /** The underlying JSON-RPC client, for callers that need another method. */
  public get rpc(): LspClient {
    return this.client;
  }

  /**
   * Run the handshake, learn the server's sync kind, and start collecting
   * diagnostics.
   *
   * @returns The `InitializeResult`, so the caller can inspect capabilities.
   */
  public async start(options: Omit<InitializeOptions, 'rootPath'> = {}): Promise<unknown> {
    const result = await this.client.initialize({ rootPath: this.workspaceRoot, ...options });
    this.syncKind = readSyncKind(result);

    this.unsubscribeDiagnostics = this.client.onNotification(
      'textDocument/publishDiagnostics',
      (params) => this.applyDiagnostics(params),
    );

    return result;
  }

  /** Notify the server that a file was opened. */
  public openDocument(path: string, text: string): void {
    const uri = this.uriFor(path);
    this.documents.set(uri, { version: 1, text });
    this.client.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: this.languageIdForPath(path),
        version: 1,
        text,
      },
    });
  }

  /** Notify the server that an open file changed. */
  public changeDocument(path: string, text: string): void {
    const uri = this.uriFor(path);
    const previous = this.documents.get(uri);
    const version = (previous?.version ?? 0) + 1;
    this.documents.set(uri, { version, text });

    const contentChanges =
      this.syncKind === 'incremental'
        ? [
            {
              // Replace the whole prior document. Valid incremental input, and it
              // avoids diffing every keystroke.
              range: {
                start: { line: 0, character: 0 },
                end: endPositionOf(previous?.text ?? ''),
              },
              text,
            },
          ]
        : [{ text }];

    this.client.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges,
    });
  }

  /** Notify the server that a file was closed and drop its diagnostics. */
  public closeDocument(path: string): void {
    const uri = this.uriFor(path);
    this.documents.delete(uri);
    this.client.notify('textDocument/didClose', { textDocument: { uri } });
    this.clearDiagnosticsFor(uri);
  }

  /** Close the client and the transport. */
  public dispose(): void {
    this.unsubscribeDiagnostics?.();
    this.unsubscribeDiagnostics = undefined;
    this.client.dispose();
  }

  private uriFor(path: string): string {
    const absolute = path.startsWith('/') ? path : `${this.workspaceRoot}/${path}`;
    return pathToFileURL(absolute).href;
  }

  private applyDiagnostics(params: unknown): void {
    if (typeof params !== 'object' || params === null) {
      return;
    }
    const payload = params as { uri?: unknown; diagnostics?: unknown };
    if (typeof payload.uri !== 'string' || !Array.isArray(payload.diagnostics)) {
      return;
    }

    const uri = payload.uri;
    this.clearDiagnosticsFor(uri);

    const inline = toInlineHints(
      { uri, diagnostics: payload.diagnostics as never },
      this.workspaceRoot,
      this.source,
    );
    const ids: string[] = [];
    for (const hint of inline) {
      ids.push(this.hints.add(hint).id);
    }
    this.hintIdsByUri.set(uri, ids);
  }

  private clearDiagnosticsFor(uri: string): void {
    const ids = this.hintIdsByUri.get(uri);
    if (ids === undefined) {
      return;
    }
    for (const id of ids) {
      this.hints.remove(id);
    }
    this.hintIdsByUri.delete(uri);
  }
}

/**
 * Read the server's document-sync kind from an `InitializeResult`.
 *
 * `textDocumentSync` is either a number or an object with a `change` field; both
 * spellings mean the same thing. Anything unset defaults to full sync, which is
 * the safe choice: sending whole documents is always valid.
 */
export function readSyncKind(result: unknown): SyncKind {
  const sync = (result as { capabilities?: { textDocumentSync?: unknown } } | null)?.capabilities
    ?.textDocumentSync;
  const kind = typeof sync === 'object' && sync !== null ? (sync as { change?: unknown }).change : sync;
  return kind === 2 ? 'incremental' : 'full';
}
