/**
 * Tests for the LSP tools.
 *
 * The manager is real but backed by a fake transport factory, and the hint store
 * is seeded directly, so the tools are exercised end to end without a language
 * server process.
 *
 * @module common/mcp/tools/lspTools.test
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InlineHintManager } from '../../debug/hints.ts';
import {
  LanguageServerManager,
  type LanguageServerConfig,
  type TransportFactory,
} from '../../lsp/languageServerManager.ts';
import type { LspTransport } from '../../lsp/lspClient.ts';
import type { ToolRegistration, ToolResult } from '../types.ts';
import { createLspTools } from './lspTools.ts';

/** A fake server that answers initialize and publishes one error per document sync. */
const publishingServer: TransportFactory = (): LspTransport => {
  const messageListeners = new Set<(message: unknown) => void>();
  const deliver = (message: unknown): void => {
    for (const listener of messageListeners) {
      listener(message);
    }
  };
  return {
    send: (message) => {
      const msg = message as { id?: number; method?: string; params?: { textDocument?: { uri: string } } };
      if (msg.method === 'initialize' && typeof msg.id === 'number') {
        queueMicrotask(() =>
          deliver({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { textDocumentSync: 1 } } }),
        );
      } else if (
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
              diagnostics: [
                {
                  range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
                  severity: 1,
                  message: 'real diagnostic',
                },
              ],
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

const TYPESCRIPT: LanguageServerConfig = {
  id: 'typescript',
  languages: ['typescript'],
  command: 'typescript-language-server',
};

interface Harness {
  readonly tools: readonly ToolRegistration[];
  readonly hints: InlineHintManager;
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nexus-lsp-tools-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function harness(configs: LanguageServerConfig[] = []): Harness {
  const hints = new InlineHintManager();
  const manager = new LanguageServerManager({
    workspaceRoot: root,
    hints,
    configs,
    transportFactory: publishingServer,
  });
  const tools = createLspTools({ workspaceRoot: root, hints, manager });
  return { tools, hints };
}

function toolNamed(tools: readonly ToolRegistration[], name: string): ToolRegistration {
  const found = tools.find((tool) => tool.definition.name === name);
  if (found === undefined) {
    throw new Error(`no tool named "${name}"`);
  }
  return found;
}

/** Unwrap a JSON payload, failing loudly on an error result. */
function payload<T>(result: ToolResult): T {
  const text = result.content[0]?.text ?? '';
  if (result.isError === true) {
    throw new Error(`tool failed: ${text}`);
  }
  return JSON.parse(text) as T;
}

function text(result: ToolResult): string {
  return result.content[0]?.text ?? '';
}

describe('configure_language_server / list_language_servers', () => {
  it('registers a server and lists it', async () => {
    const h = harness();

    const configured = payload<{ servers: { id: string; running: boolean }[] }>(
      await toolNamed(h.tools, 'configure_language_server').handler({
        id: 'typescript',
        languages: ['typescript'],
        command: 'typescript-language-server',
        args: ['--stdio'],
      }),
    );

    expect(configured.servers).toHaveLength(1);
    expect(configured.servers[0]).toMatchObject({ id: 'typescript', running: false });

    const listed = payload<{ servers: { command: string }[] }>(
      await toolNamed(h.tools, 'list_language_servers').handler({}),
    );
    expect(listed.servers[0]?.command).toBe('typescript-language-server');
  });
});

describe('get_diagnostics', () => {
  it('returns every known hint when no path is given', async () => {
    const h = harness();
    h.hints.add({ filePath: 'a.ts', line: 1, message: 'x', severity: 'error' });
    h.hints.add({ filePath: 'a.ts', line: 2, message: 'y', severity: 'warning' });

    const result = payload<{ count: number; errors: number; warnings: number; path: null }>(
      await toolNamed(h.tools, 'get_diagnostics').handler({ refresh: false }),
    );

    expect(result.path).toBeNull();
    expect(result).toMatchObject({ count: 2, errors: 1, warnings: 1 });
  });

  it('filters to one file when a path is given and refresh is off', async () => {
    const h = harness();
    h.hints.add({ filePath: 'a.ts', line: 1, message: 'x', severity: 'error' });
    h.hints.add({ filePath: 'b.ts', line: 1, message: 'y', severity: 'error' });

    const result = payload<{ path: string; count: number; diagnostics: { filePath: string }[] }>(
      await toolNamed(h.tools, 'get_diagnostics').handler({ path: 'a.ts', refresh: false }),
    );

    expect(result.path).toBe('a.ts');
    expect(result.count).toBe(1);
    expect(result.diagnostics[0]?.filePath).toBe('a.ts');
  });

  it('refreshes the file in its language server before answering', async () => {
    await writeFile(join(root, 'a.ts'), 'const x = 1;', 'utf8');
    const h = harness([TYPESCRIPT]);

    const result = payload<{ path: string; server: string | null; diagnostics: { line: number; source?: string }[] }>(
      await toolNamed(h.tools, 'get_diagnostics').handler({ path: 'a.ts', waitMs: 500, refresh: true }),
    );

    expect(result.server).toBe('typescript');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ line: 3, source: 'lsp:typescript' });
  });

  it('reports a traversal attempt as an error result instead of throwing', async () => {
    const h = harness([TYPESCRIPT]);

    const result = await toolNamed(h.tools, 'get_diagnostics').handler({
      path: '../escape.ts',
      refresh: true,
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('escapes the workspace');
  });
});
