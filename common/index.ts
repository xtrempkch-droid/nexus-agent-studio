/**
 * Public entry point for the headless core.
 *
 * Re-exports the whole `common/` surface and, when executed directly
 * (`node dist/core.mjs`), boots the internal MCP server over stdio.
 *
 * IMPORTANT: stdout is the JSON-RPC channel. Never `console.log` here — use
 * `console.error` for diagnostics.
 *
 * @module common/index
 */

import { pathToFileURL } from 'node:url';
import { createCore } from './core.ts';
import type { LanguageServerConfig } from './lsp/languageServerManager.ts';

export * from './core.ts';

export * from './mcp/server.ts';
export * from './mcp/types.ts';
export * from './mcp/tools/index.ts';

export * from './debug/logger.ts';
export * from './debug/hints.ts';

export * from './lsp/framing.ts';
export * from './lsp/diagnostics.ts';
export * from './lsp/lspClient.ts';
export * from './lsp/stdioTransport.ts';
export * from './lsp/languageService.ts';
export * from './lsp/languageServerManager.ts';

export * from './docker/sandbox.ts';
export * from './docker/compilerErrorParser.ts';

export * from './plugins/types.ts';
export * from './plugins/pluginManager.ts';

export * from './security/pathGuard.ts';
export * from './themes/themeManager.ts';

/**
 * Whether unsandboxed local command execution was requested.
 *
 * Opt-in through the environment and nowhere else. A webview must not be able to
 * turn isolation off, and `RUN.sh` is the single place that sets this — printed
 * next to the warning that goes with it, so the choice is never implicit.
 */
function allowLocalExecutionFromEnvironment(): boolean {
  const value = process.env['NEXUS_UNSANDBOXED'];
  return value === '1' || value === 'true';
}

/**
 * Start the core as a stdio MCP server for the current working directory.
 *
 * @returns The stdio handle, so callers can close it.
 */
export function startStdioServer(workspaceRoot: string = process.cwd()) {
  const unsandboxed = allowLocalExecutionFromEnvironment();
  const languageServers = languageServersFromEnvironment();
  const core = createCore({
    workspaceRoot,
    allowLocalExecution: unsandboxed,
    ...(languageServers.length === 0 ? {} : { languageServers }),
  });
  console.error(
    `[nexus] serving ${core.server.getToolNames().length} tools over stdio ` +
      `(root: ${workspaceRoot})${unsandboxed ? ' [execucao local SEM ISOLAMENTO]' : ''}` +
      `${languageServers.length === 0 ? '' : ` [lsp: ${languageServers.map((s) => s.id).join(', ')}]`}`,
  );
  return core;
}

/**
 * Language servers from `NEXUS_LSP_SERVERS`, a JSON array of
 * {@link LanguageServerConfig}.
 *
 * The environment is the shell's channel to configure the core it spawns (the
 * webview is never trusted with process configuration). More servers can be
 * added at runtime through the `configure_language_server` tool. A malformed
 * value is reported and ignored rather than crashing the core on startup.
 */
function languageServersFromEnvironment(): LanguageServerConfig[] {
  const raw = process.env['NEXUS_LSP_SERVERS'];
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LanguageServerConfig[]) : [];
  } catch (error) {
    console.error(`[nexus] NEXUS_LSP_SERVERS ignored (invalid JSON): ${(error as Error).message}`);
    return [];
  }
}

/* c8 ignore start -- process bootstrap */
const entryPoint = process.argv[1];
const invokedDirectly =
  entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;

if (invokedDirectly) {
  startStdioServer().server.serveStdio();
}
/* c8 ignore stop */
