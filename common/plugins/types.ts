/**
 * Plugin contracts.
 *
 * A plugin is a declarative manifest plus a lifecycle implementation. It never
 * gets raw access to the file-system, the Docker client or the transport; it
 * receives a {@link PluginContext} with controlled instances of the MCP server,
 * the execution logger and the terminal runner. Capabilities it declares in
 * `permissions` are informational, so a future sandboxed loader can enforce them.
 *
 * @module common/plugins/types
 */

import type * as z from 'zod/v4';
import type { ExecutionLogger } from '../debug/logger.ts';
import type { InternalMCPServer } from '../mcp/server.ts';
import type { ToolDefinition, ToolHandler } from '../mcp/types.ts';
import type { TerminalRunner } from '../mcp/tools/terminalTools.ts';

/**
 * Declared capabilities. Used for review, display and future enforcement.
 */
export interface PluginPermissions {
  /** May read/write inside the workspace (through the MCP file tools). */
  readonly filesystem?: boolean;
  /** May execute commands in the Docker sandbox. */
  readonly terminal?: boolean;
  /** May reach the network from the sandbox. */
  readonly network?: boolean;
  /** May register MCP tools. */
  readonly mcpTools?: boolean;
}

/**
 * Static metadata describing a plugin.
 */
export interface PluginManifest {
  /** Reverse-DNS-ish unique id, e.g. `nexus.git-helper`. */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Semver version string. */
  readonly version: string;
  /** Module path the host resolves to obtain the plugin's default export. */
  readonly entryPoint: string;
  /** Declared capabilities. */
  readonly permissions: PluginPermissions;
  /** Optional description shown in the plugin list. */
  readonly description?: string;
}

/**
 * Controlled surface handed to a plugin on load.
 */
export interface PluginContext {
  /** The plugin's own manifest (read-only). */
  readonly manifest: PluginManifest;
  /** The internal MCP server, for `registerDynamicTool`. */
  readonly mcp: InternalMCPServer;
  /** Shared execution logger. */
  readonly logger: ExecutionLogger;
  /** Sandboxed command runner. */
  readonly terminal: TerminalRunner;
  /**
   * Register a tool owned by this plugin. The plugin id is taken from the
   * manifest, so tools are always attributed correctly. Generic over the
   * schema, so a handler's arguments are inferred from `inputSchema`.
   */
  registerTool<TSchema extends z.ZodType>(
    tool: ToolDefinition<TSchema>,
    handler: ToolHandler<TSchema>,
  ): void;
}

/**
 * Lifecycle contract every plugin implements.
 */
export interface PluginLifecycle {
  /**
   * Called once when the plugin is loaded. Register tools here.
   *
   * @param context - Controlled access to server, logger and terminal.
   */
  onLoad(context: PluginContext): Promise<void>;

  /**
   * Called when the plugin is unloaded. Release timers, sockets and file
   * handles here. Registered tools are removed by the manager automatically.
   */
  onUnload(): Promise<void>;
}

/** A plugin instance paired with its manifest. */
export interface PluginModule {
  readonly manifest: PluginManifest;
  readonly lifecycle: PluginLifecycle;
}

/** A successfully loaded plugin. */
export interface LoadedPlugin {
  readonly manifest: PluginManifest;
  readonly instance: PluginLifecycle;
  readonly loadedAt: number;
  /** Names of the MCP tools this plugin registered. */
  readonly registeredTools: readonly string[];
}
