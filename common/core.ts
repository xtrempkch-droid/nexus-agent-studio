/**
 * Core composition root.
 *
 * Wires the MCP server, the execution logger, the Docker sandbox, the editor
 * context store, the theme manager and the plugin manager into a single object.
 * This is the only place where the concrete collaborators are chosen, which
 * keeps every other module testable in isolation.
 *
 * @module common/core
 */

import { ExecutionLogger } from './debug/logger.ts';
import { LocalRunner } from './docker/localRunner.ts';
import { DockerSandbox, type Sandbox } from './docker/sandbox.ts';
import { InternalMCPServer } from './mcp/server.ts';
import { EditorContextStore, createEditorTools } from './mcp/tools/editorTools.ts';
import { createFileTools } from './mcp/tools/fileTools.ts';
import {
  DEFAULT_SANDBOX_IMAGE,
  createTerminalRunner,
  createTerminalTools,
  type TerminalRunner,
} from './mcp/tools/terminalTools.ts';
import { PluginManager } from './plugins/pluginManager.ts';
import { DARK_THEME, ThemeManager, type ThemeObject } from './themes/themeManager.ts';

/** Options accepted by {@link createCore}. */
export interface CoreOptions {
  /** Absolute workspace root. Every file tool is confined to this directory. */
  readonly workspaceRoot: string;
  /** Server name advertised during `initialize`. */
  readonly serverName?: string;
  /** Server version advertised during `initialize`. */
  readonly serverVersion?: string;
  /** Default sandbox image for `run_terminal_command`. */
  readonly sandboxImage?: string;
  /** Inject a custom sandbox (used by tests). */
  readonly sandbox?: Sandbox;
  /**
   * Run terminal commands directly on the host instead of in a container.
   *
   * Defaults to `false`, and nothing infers it: Docker is the product's promise,
   * and turning isolation off has to be asked for. What it changes is only
   * *where* the command runs — every result is still labelled with
   * `local (sem isolamento)` so the log cannot be mistaken for a sandboxed one.
   */
  readonly allowLocalExecution?: boolean;
  /** Initial UI theme. Defaults to the built-in dark skin. */
  readonly theme?: ThemeObject;
  /** Command timeout for the sandbox, in milliseconds. */
  readonly terminalTimeoutMs?: number;
}

/** The assembled core, ready to be driven by any UI. */
export interface NexusCore {
  readonly server: InternalMCPServer;
  readonly logger: ExecutionLogger;
  readonly themes: ThemeManager;
  readonly editorContext: EditorContextStore;
  readonly plugins: PluginManager;
  readonly sandbox: Sandbox;
  readonly terminal: TerminalRunner;
}

/**
 * Build a fully wired core instance.
 *
 * @param options - Workspace root plus optional overrides.
 */
export function createCore(options: CoreOptions): NexusCore {
  const logger = new ExecutionLogger(options.workspaceRoot);
  const themes = new ThemeManager(options.theme ?? DARK_THEME);
  const editorContext = new EditorContextStore();
  const sandbox =
    options.sandbox ??
    (options.allowLocalExecution === true ? new LocalRunner() : new DockerSandbox());

  const server = new InternalMCPServer({
    name: options.serverName ?? 'nexus-agent-studio',
    version: options.serverVersion ?? '0.1.0',
  });

  const terminalOptions = {
    workspaceRoot: options.workspaceRoot,
    logger,
    sandbox,
    defaultImage: options.sandboxImage ?? DEFAULT_SANDBOX_IMAGE,
    ...(options.terminalTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: options.terminalTimeoutMs }),
  };

  for (const tool of createFileTools({ workspaceRoot: options.workspaceRoot, logger })) {
    server.registerTool(tool.definition, tool.handler);
  }

  for (const tool of createEditorTools(editorContext)) {
    server.registerTool(tool.definition, tool.handler);
  }

  for (const tool of createTerminalTools(terminalOptions)) {
    server.registerTool(tool.definition, tool.handler);
  }

  const terminal = createTerminalRunner(terminalOptions);

  const plugins = new PluginManager({ mcp: server, logger, terminal });

  return { server, logger, themes, editorContext, plugins, sandbox, terminal };
}
