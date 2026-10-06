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

export * from './core.ts';

export * from './mcp/server.ts';
export * from './mcp/types.ts';
export * from './mcp/tools/index.ts';

export * from './debug/logger.ts';
export * from './debug/hints.ts';

export * from './docker/sandbox.ts';
export * from './docker/compilerErrorParser.ts';

export * from './plugins/types.ts';
export * from './plugins/pluginManager.ts';

export * from './security/pathGuard.ts';
export * from './themes/themeManager.ts';

/**
 * Start the core as a stdio MCP server for the current working directory.
 *
 * @returns The stdio handle, so callers can close it.
 */
export function startStdioServer(workspaceRoot: string = process.cwd()) {
  const core = createCore({ workspaceRoot });
  console.error(
    `[nexus] serving ${core.server.getToolNames().length} tools over stdio (root: ${workspaceRoot})`,
  );
  return core;
}

/* c8 ignore start -- process bootstrap */
const entryPoint = process.argv[1];
const invokedDirectly =
  entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href;

if (invokedDirectly) {
  startStdioServer().server.serveStdio();
}
/* c8 ignore stop */
