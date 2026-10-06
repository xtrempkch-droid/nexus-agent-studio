/**
 * Internal MCP server.
 *
 * A lifecycle wrapper over the MCP v2 `McpServer` factory. The wrapper owns the
 * **registrations** (built-in tools plus dynamically injected plugin tools) and
 * builds a fresh `McpServer` per connection, which is exactly what
 * `serveStdio(factory)` requires:
 *
 * ```ts
 * import { serveStdio } from '@modelcontextprotocol/server/stdio';
 * const handle = serveStdio(() => internalServer.build());
 * ```
 *
 * The dynamic-tool API (`registerDynamicTool` / `unregisterToolsByPlugin`) is a
 * facility this project adds on top of the SDK, which has no native plugin
 * concept.
 *
 * @module common/mcp/server
 */

import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type * as z from 'zod/v4';
import type { ToolContext, ToolDefinition, ToolHandler, ToolResult } from './types.ts';

/** Options for {@link InternalMCPServer}. */
export interface InternalMCPServerOptions {
  /** Server name advertised during `initialize`. */
  readonly name?: string;
  /** Server version advertised during `initialize`. */
  readonly version?: string;
  /**
   * Upper bound on the combined number of array elements and object members a
   * single tool call's arguments may contain. Passed through to `McpServer`.
   */
  readonly maxToolInputElements?: number;
}

/** A registration entry stored in the registry. */
interface RegisteredTool {
  readonly definition: ToolDefinition;
  /** Type-erased handler; the SDK validated the arguments before invocation. */
  readonly handler: (args: unknown, ctx?: ToolContext) => Promise<ToolResult>;
  /** Owning plugin id, or `undefined` for built-in tools. */
  readonly pluginId?: string;
}

/** Reserved plugin id used for built-in tools. Cannot be unregistered. */
export const CORE_PLUGIN_ID = 'core';

/** Return type of `serveStdio`. */
export type StdioServerHandle = ReturnType<typeof serveStdio>;

/**
 * Registry + factory for the editor's internal MCP server.
 */
export class InternalMCPServer {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly pluginTools = new Map<string, Set<string>>();
  private readonly name: string;
  private readonly version: string;
  private readonly maxToolInputElements: number | undefined;

  /**
   * @param options - Server identity and optional argument-size guard.
   */
  public constructor(options: InternalMCPServerOptions = {}) {
    this.name = options.name ?? 'nexus-agent-studio';
    this.version = options.version ?? '0.1.0';
    this.maxToolInputElements = options.maxToolInputElements;
  }

  /**
   * Register a built-in tool.
   *
   * @typeParam TSchema - Zod schema describing the arguments.
   * @param definition - Name, description and input schema.
   * @param handler - Invoked after the SDK validates the arguments.
   */
  public registerTool<TSchema extends z.ZodType>(
    definition: ToolDefinition<TSchema>,
    handler: ToolHandler<TSchema>,
  ): void {
    this.register(definition, handler, undefined);
  }

  /**
   * Register a tool owned by a plugin, so the whole set can be revoked when the
   * plugin is unloaded or crashes.
   *
   * @param pluginId - Owning plugin; `core` is reserved.
   * @param toolDefinition - The tool's metadata and schema.
   * @param handler - Tool implementation.
   */
  public registerDynamicTool<TSchema extends z.ZodType>(
    pluginId: string,
    toolDefinition: ToolDefinition<TSchema>,
    handler: ToolHandler<TSchema>,
  ): void {
    if (pluginId === CORE_PLUGIN_ID) {
      throw new Error(`Plugin id "${CORE_PLUGIN_ID}" is reserved for built-in tools.`);
    }
    this.register(toolDefinition, handler, pluginId);
  }

  /**
   * Remove every tool registered by a plugin.
   *
   * @returns The number of tools removed.
   */
  public unregisterToolsByPlugin(pluginId: string): number {
    const owned = this.pluginTools.get(pluginId);
    if (owned === undefined) {
      return 0;
    }

    let removed = 0;
    for (const name of owned) {
      if (this.tools.delete(name)) {
        removed += 1;
      }
    }
    this.pluginTools.delete(pluginId);
    return removed;
  }

  /** Names of all registered tools, sorted. */
  public getToolNames(): string[] {
    return [...this.tools.keys()].sort();
  }

  /** Look up a tool definition by name. */
  public getToolDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  /** Total number of registered tools. */
  public get size(): number {
    return this.tools.size;
  }

  /**
   * Build a fresh `McpServer` with every registered tool applied.
   *
   * A new instance is required per connection because `serveStdio` calls its
   * factory once per connecting client.
   */
  public build(): McpServer {
    const serverOptions =
      this.maxToolInputElements === undefined
        ? undefined
        : { maxToolInputElements: this.maxToolInputElements };

    const server =
      serverOptions === undefined
        ? new McpServer({ name: this.name, version: this.version })
        : new McpServer({ name: this.name, version: this.version }, serverOptions);

    for (const tool of this.tools.values()) {
      server.registerTool(
        tool.definition.name,
        {
          description: tool.definition.description,
          inputSchema: tool.definition.inputSchema,
        },
        // The SDK validates `arguments` against `inputSchema` before calling the
        // handler, so re-typing the erased handler here is sound. The cast is
        // required because the registry is type-erased.
        //
        // The SDK also hands the handler a second `ctx` argument whose `notify`
        // sends a notification on the same channel as the request. It is adapted
        // to our dependency-light `ToolContext` so handlers never have to know
        // the SDK's shape — and it is omitted entirely when absent.
        (async (args: unknown, ctx: ServerContext) =>
          tool.handler(
            args,
            // Errors from a notification must never fail the turn that triggered
            // it: streaming is best-effort, so rejections are swallowed here.
            { notify: (notification) => ctx.mcpReq.notify(notification).catch(() => {}) },
          )) as never,
      );
    }

    return server;
  }

  /**
   * Serve this registry over stdio.
   *
   * @returns The `StdioServerHandle`; call `.close()` to shut down cleanly.
   */
  public serveStdio(): StdioServerHandle {
    return serveStdio(() => this.build());
  }

  private register<TSchema extends z.ZodType>(
    definition: ToolDefinition<TSchema>,
    handler: ToolHandler<TSchema>,
    pluginId: string | undefined,
  ): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered.`);
    }

    const erased = handler as unknown as (args: unknown, ctx?: ToolContext) => Promise<ToolResult>;

    this.tools.set(definition.name, {
      definition,
      handler: async (args, ctx) => erased(args, ctx),
      ...(pluginId === undefined ? {} : { pluginId }),
    });

    if (pluginId !== undefined) {
      const owned = this.pluginTools.get(pluginId) ?? new Set<string>();
      owned.add(definition.name);
      this.pluginTools.set(pluginId, owned);
    }
  }
}
