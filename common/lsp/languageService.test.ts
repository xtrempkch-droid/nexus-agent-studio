/**
 * Tests for the language-service bridge.
 *
 * A fake transport plays the server side, so the tests pin down the document
 * lifecycle, diagnostics-to-hints translation, per-file replacement, cleanup on
 * close, and the full-vs-incremental sync decision.
 *
 * @module common/lsp/languageService.test
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { InlineHintManager } from '../debug/hints.ts';
import { LanguageService, endPositionOf, defaultLanguageId, readSyncKind } from './languageService.ts';
import type { LspTransport } from './lspClient.ts';

const ROOT = '/home/dev/project';
const MAIN_URI = pathToFileURL(join(ROOT, 'src', 'main.ts')).href;

interface FakeTransport extends LspTransport {
  readonly sent: Record<string, unknown>[];
  deliver(message: unknown): void;
}

function fakeTransport(): FakeTransport {
  const sent: Record<string, unknown>[] = [];
  const messageListeners = new Set<(message: unknown) => void>();
  const closeListeners = new Set<() => void>();
  return {
    sent,
    send: (message) => {
      sent.push(message as Record<string, unknown>);
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
  };
}

interface Harness {
  readonly transport: FakeTransport;
  readonly hints: InlineHintManager;
  readonly service: LanguageService;
  start(syncKind: number): Promise<void>;
}

function harness(): Harness {
  const transport = fakeTransport();
  const hints = new InlineHintManager();
  const service = new LanguageService({
    transport,
    workspaceRoot: ROOT,
    hints,
    source: 'lsp:ts',
  });

  return {
    transport,
    hints,
    service,
    async start(syncKind: number): Promise<void> {
      const started = service.start();
      const sent = transport.sent[0] as { id: number };
      transport.deliver({
        jsonrpc: '2.0',
        id: sent.id,
        result: { capabilities: { textDocumentSync: syncKind } },
      });
      await started;
    },
  };
}

/** Deliver a publishDiagnostics notification for one file. */
function publish(
  transport: FakeTransport,
  uri: string,
  diagnostics: readonly { line: number; message: string; severity?: number }[],
): void {
  transport.deliver({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: {
      uri,
      diagnostics: diagnostics.map((d) => ({
        range: { start: { line: d.line, character: 0 }, end: { line: d.line, character: 1 } },
        message: d.message,
        ...(d.severity === undefined ? {} : { severity: d.severity }),
      })),
    },
  });
}

describe('readSyncKind', () => {
  it('reads both the number and the object spelling, defaulting to full', () => {
    expect(readSyncKind({ capabilities: { textDocumentSync: 1 } })).toBe('full');
    expect(readSyncKind({ capabilities: { textDocumentSync: 2 } })).toBe('incremental');
    expect(readSyncKind({ capabilities: { textDocumentSync: { change: 2 } } })).toBe('incremental');
    expect(readSyncKind({ capabilities: {} })).toBe('full');
  });
});

describe('endPositionOf', () => {
  it('points just past the last character', () => {
    expect(endPositionOf('abc')).toEqual({ line: 0, character: 3 });
    expect(endPositionOf('a\nbc')).toEqual({ line: 1, character: 2 });
    expect(endPositionOf('')).toEqual({ line: 0, character: 0 });
  });
});

describe('defaultLanguageId', () => {
  it('maps common extensions and falls back to plaintext', () => {
    expect(defaultLanguageId('src/main.ts')).toBe('typescript');
    expect(defaultLanguageId('a/b.py')).toBe('python');
    expect(defaultLanguageId('LICENSE')).toBe('plaintext');
  });
});

describe('LanguageService', () => {
  it('opens documents with the resolved language id', async () => {
    const h = harness();
    await h.start(1);

    h.service.openDocument('src/main.ts', 'const x = 1;');

    const didOpen = h.transport.sent.find((m) => m['method'] === 'textDocument/didOpen');
    expect(didOpen?.['params']).toMatchObject({
      textDocument: { uri: MAIN_URI, languageId: 'typescript', version: 1 },
    });
  });

  it('turns published diagnostics into inline hints', async () => {
    const h = harness();
    await h.start(1);

    publish(h.transport, MAIN_URI, [
      { line: 0, message: 'erro', severity: 1 },
      { line: 3, message: 'aviso', severity: 2 },
    ]);

    const all = h.hints.all();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ filePath: 'src/main.ts', line: 1, severity: 'error', source: 'lsp:ts' });
    expect(all[1]).toMatchObject({ line: 4, severity: 'warning' });
  });

  it('replaces a file\'s diagnostics on the next publish instead of accumulating', async () => {
    const h = harness();
    await h.start(1);

    publish(h.transport, MAIN_URI, [{ line: 0, message: 'first', severity: 1 }]);
    publish(h.transport, MAIN_URI, [{ line: 1, message: 'second', severity: 1 }]);

    const all = h.hints.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.message).toBe('second');
  });

  it('drops a file\'s diagnostics when it is closed', async () => {
    const h = harness();
    await h.start(1);

    h.service.openDocument('src/main.ts', 'x');
    publish(h.transport, MAIN_URI, [{ line: 0, message: 'erro', severity: 1 }]);
    expect(h.hints.all()).toHaveLength(1);

    h.service.closeDocument('src/main.ts');
    expect(h.hints.all()).toHaveLength(0);
  });

  it('sends full-document changes when the server negotiated full sync', async () => {
    const h = harness();
    await h.start(1);

    h.service.openDocument('src/main.ts', 'a');
    h.service.changeDocument('src/main.ts', 'ab');

    const didChange = h.transport.sent.filter((m) => m['method'] === 'textDocument/didChange');
    const params = didChange[0]?.['params'] as {
      textDocument: { version: number };
      contentChanges: unknown[];
    };
    expect(params.textDocument.version).toBe(2);
    expect(params.contentChanges).toEqual([{ text: 'ab' }]);
  });

  it('replaces the whole document with a range when sync is incremental', async () => {
    const h = harness();
    await h.start(2);

    h.service.openDocument('src/main.ts', 'a\nb');
    h.service.changeDocument('src/main.ts', 'c');

    const didChange = h.transport.sent.filter((m) => m['method'] === 'textDocument/didChange');
    const params = didChange[0]?.['params'] as { contentChanges: { range: unknown; text: string }[] };
    expect(params.contentChanges[0]?.text).toBe('c');
    expect(params.contentChanges[0]?.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 1, character: 1 },
    });
  });

  it('ignores diagnostics for files outside the workspace', async () => {
    const h = harness();
    await h.start(1);

    publish(h.transport, pathToFileURL('/etc/passwd').href, [
      { line: 0, message: 'nope', severity: 1 },
    ]);

    expect(h.hints.all()).toHaveLength(0);
  });
});
