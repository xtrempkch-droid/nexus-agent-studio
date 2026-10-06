/**
 * Tests for the language-server orchestrator.
 *
 * A fake transport factory plays a real LSP server: it answers `initialize` and
 * answers each `didOpen`/`didChange` with a `publishDiagnostics` notification.
 * That exercises the whole refresh path — lazy start, document sync, waiting for
 * the push — without spawning a process.
 *
 * @module common/lsp/languageServerManager.test
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InlineHintManager } from '../debug/hints.ts';
import {
  LanguageServerManager,
  type LanguageServerConfig,
  type TransportFactory,
} from './languageServerManager.ts';
import type { LspTransport } from './lspClient.ts';

/**
 * Build a transport factory for a fake server that answers `initialize` and
 * publishes diagnostics after each document sync.
 *
 * @param diagnosticsFor - Diagnostics to publish for a given document URI.
 * @param observe - Optional hook called with every `textDocument/*` method sent.
 */
function fakeServerFactory(
  diagnosticsFor: (uri: string) => { message: string; severity?: number }[],
  observe?: (method: string) => void,
): TransportFactory {
  return (): LspTransport => {
    const messageListeners = new Set<(message: unknown) => void>();
    const deliver = (message: unknown): void => {
      for (const listener of messageListeners) {
        listener(message);
      }
    };

    return {
      send: (message) => {
        const msg = message as {
          id?: number;
          method?: string;
          params?: { textDocument?: { uri: string } };
        };
        if (msg.method === 'initialize' && typeof msg.id === 'number') {
          queueMicrotask(() =>
            deliver({
              jsonrpc: '2.0',
              id: msg.id,
              result: { capabilities: { textDocumentSync: 1 } },
            }),
          );
          return;
        }
        if (msg.method?.startsWith('textDocument/') === true) {
          observe?.(msg.method);
        }
        if (
          (msg.method === 'textDocument/didOpen' || msg.method === 'textDocument/didChange') &&
          msg.params?.textDocument !== undefined
        ) {
          const uri = msg.params.textDocument.uri;
          queueMicrotask(() =>
            deliver({
              jsonrpc: '2.0',
              method: 'textDocument/publishDiagnostics',
              params: {
                uri,
                diagnostics: diagnosticsFor(uri).map((d) => ({
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                  message: d.message,
                  ...(d.severity === undefined ? {} : { severity: d.severity }),
                })),
              },
            }),
          );
        }
      },
      onMessage: (listener) => {
        messageListeners.add(listener);
      },
      onClose: () => undefined,
      close: () => undefined,
    };
  };
}

/** A factory whose server accepts initialize but never publishes. */
const silentServer: TransportFactory = (): LspTransport => {
  const messageListeners = new Set<(message: unknown) => void>();
  return {
    send: (message) => {
      const msg = message as { id?: number; method?: string };
      if (msg.method === 'initialize' && typeof msg.id === 'number') {
        queueMicrotask(() => {
          for (const listener of messageListeners) {
            listener({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
          }
        });
      }
    },
    onMessage: (listener) => {
      messageListeners.add(listener);
    },
    onClose: () => undefined,
    close: () => undefined,
  };
};

const TYPESCRIPT: LanguageServerConfig = {
  id: 'typescript',
  languages: ['typescript'],
  command: 'typescript-language-server',
  args: ['--stdio'],
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nexus-lsp-manager-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('LanguageServerManager', () => {
  it('starts a server lazily and reports the diagnostics it publishes', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;', 'utf8');
    const hints = new InlineHintManager();
    const manager = new LanguageServerManager({
      workspaceRoot: root,
      hints,
      configs: [TYPESCRIPT],
      transportFactory: fakeServerFactory(() => [{ message: 'boom', severity: 1 }]),
    });

    const result = await manager.refresh('a.ts');

    expect(result.server).toBe('typescript');
    expect(result.filePath).toBe('a.ts');
    expect(hints.all()).toHaveLength(1);
    expect(hints.all()[0]).toMatchObject({
      filePath: 'a.ts',
      severity: 'error',
      source: 'lsp:typescript',
    });

    manager.dispose();
  });

  it('returns no server for a language that is not configured', async () => {
    await writeFile(join(root, 'a.py'), 'x = 1', 'utf8');
    const manager = new LanguageServerManager({
      workspaceRoot: root,
      hints: new InlineHintManager(),
    });

    expect((await manager.refresh('a.py')).server).toBeNull();
    manager.dispose();
  });

  it('does not hang when the server never publishes', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;', 'utf8');
    const manager = new LanguageServerManager({
      workspaceRoot: root,
      hints: new InlineHintManager(),
      configs: [TYPESCRIPT],
      transportFactory: silentServer,
    });

    expect((await manager.refresh('a.ts', 20)).server).toBe('typescript');
    manager.dispose();
  });

  it('sends didChange on the second refresh instead of didOpen again', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;', 'utf8');
    const synced: string[] = [];
    const manager = new LanguageServerManager({
      workspaceRoot: root,
      hints: new InlineHintManager(),
      configs: [TYPESCRIPT],
      transportFactory: fakeServerFactory(() => [], (method) => synced.push(method)),
    });

    await manager.refresh('a.ts', 20);
    await writeFile(join(root, 'a.ts'), 'const x = 2;', 'utf8');
    await manager.refresh('a.ts', 20);

    expect(synced).toEqual(['textDocument/didOpen', 'textDocument/didChange']);
    manager.dispose();
  });

  it('stops a running server when it is reconfigured', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;', 'utf8');
    const manager = new LanguageServerManager({
      workspaceRoot: root,
      hints: new InlineHintManager(),
      configs: [TYPESCRIPT],
      transportFactory: silentServer,
    });

    await manager.refresh('a.ts', 20);
    expect(manager.listServers()[0]?.running).toBe(true);

    manager.configureServer({ ...TYPESCRIPT, command: 'other-server' });
    expect(manager.listServers()[0]?.running).toBe(false);
    expect(manager.listServers()[0]?.command).toBe('other-server');

    manager.dispose();
  });

  it('confines the path to the workspace', async () => {
    const manager = new LanguageServerManager({
      workspaceRoot: root,
      hints: new InlineHintManager(),
    });
    await expect(manager.refresh('../escape.ts')).rejects.toThrow(/escapes the workspace/);
    manager.dispose();
  });
});
