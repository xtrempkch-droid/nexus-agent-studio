/**
 * LSP tools: configure language servers and read diagnostics.
 *
 * `get_diagnostics` is the tool both the UI and the agent use. It optionally
 * **refreshes** the file first — opening it in its language server and waiting
 * for fresh diagnostics — then answers from the shared hint store, which already
 * holds the compiler diagnostics produced by `run_terminal_command`. One store,
 * one shape, whoever produced the hint.
 *
 * @module common/mcp/tools/lspTools
 */

import * as z from 'zod/v4';
import type { InlineHintManager } from '../../debug/hints.ts';
import type { LanguageServerManager } from '../../lsp/languageServerManager.ts';
import { resolveWorkspacePath, toWorkspaceRelative } from '../../security/pathGuard.ts';
import { errorResult, jsonResult, type AnyToolHandler, type ToolRegistration } from '../types.ts';

/** Dependencies for {@link createLspTools}. */
export interface LspToolsOptions {
  /** Absolute workspace root, for confining the paths. */
  readonly workspaceRoot: string;
  /** Shared hint store (compiler and LSP diagnostics alike). */
  readonly hints: InlineHintManager;
  /** The language-server orchestrator. */
  readonly manager: LanguageServerManager;
}

/** Count hints per severity, for a quick summary. */
function severityCounts(hints: readonly { readonly severity: string }[]): {
  errors: number;
  warnings: number;
  infos: number;
} {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const hint of hints) {
    if (hint.severity === 'error') {
      errors += 1;
    } else if (hint.severity === 'warning') {
      warnings += 1;
    } else {
      infos += 1;
    }
  }
  return { errors, warnings, infos };
}

/** Register the language-server tools. */
export function createLspTools(options: LspToolsOptions): ToolRegistration[] {
  const { workspaceRoot, hints, manager } = options;

  const configureTool: ToolRegistration = {
    definition: {
      name: 'configure_language_server',
      description:
        'Register or replace a language server. The server is started lazily the ' +
        'first time a file of one of its languages is checked. Reconfiguring a ' +
        'running server stops it so the next check restarts it.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Stable id, e.g. typescript. Also tags the diagnostics.'),
        languages: z
          .array(z.string().min(1))
          .min(1)
          .describe('LSP language ids served, e.g. ["typescript", "typescriptreact"].'),
        command: z.string().min(1).describe('Executable to launch, e.g. typescript-language-server.'),
        args: z.array(z.string()).optional().describe('Command-line arguments.'),
        env: z
          .record(z.string(), z.string())
          .optional()
          .describe('Extra environment variables for the server process.'),
        initializationOptions: z
          .unknown()
          .optional()
          .describe('Value sent as initializationOptions during the handshake.'),
      }),
    },
    handler: (args) => {
      manager.configureServer({
        id: args.id,
        languages: args.languages,
        command: args.command,
        ...(args.args === undefined ? {} : { args: args.args }),
        ...(args.env === undefined ? {} : { env: args.env }),
        ...(args.initializationOptions === undefined
          ? {}
          : { initializationOptions: args.initializationOptions }),
      });
      return jsonResult({ servers: manager.listServers() });
    },
  };

  const listTool: ToolRegistration = {
    definition: {
      name: 'list_language_servers',
      description: 'List the configured language servers and whether each one is running.',
      inputSchema: z.object({}),
    },
    handler: () => jsonResult({ servers: manager.listServers() }),
  };

  const handler: AnyToolHandler = async ({ path, waitMs, refresh }) => {
    try {
      if (typeof path === 'string' && path !== '') {
        let filePath: string;
        let server: string | null = null;

        if (refresh === true) {
          const result = await manager.refresh(path, waitMs);
          filePath = result.filePath;
          server = result.server;
        } else {
          filePath = toWorkspaceRelative(workspaceRoot, resolveWorkspacePath(workspaceRoot, path));
        }

        const diagnostics = hints.getForFile(filePath);
        return jsonResult({
          path: filePath,
          server,
          count: diagnostics.length,
          ...severityCounts(diagnostics),
          diagnostics,
        });
      }

      const diagnostics = hints.all();
      return jsonResult({
        path: null,
        server: null,
        count: diagnostics.length,
        ...severityCounts(diagnostics),
        diagnostics,
      });
    } catch (error) {
      return errorResult(`Falha ao obter diagnósticos: ${(error as Error).message}`);
    }
  };

  const diagnosticsTool: ToolRegistration = {
    definition: {
      name: 'get_diagnostics',
      description:
        'Return the diagnostics (errors and warnings) known for the workspace. When ' +
        '"path" is given it first refreshes that file in its language server and ' +
        'returns its diagnostics; without "path" it returns every known diagnostic.',
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe('Workspace-relative file to refresh and report diagnostics for.'),
        waitMs: z
          .number()
          .int()
          .min(0)
          .max(30_000)
          .optional()
          .describe('How long to wait for the language server to answer, in ms.'),
        refresh: z
          .boolean()
          .default(true)
          .describe('Whether to open/update the file in its language server first.'),
      }),
    },
    handler,
  };

  return [configureTool, listTool, diagnosticsTool];
}
