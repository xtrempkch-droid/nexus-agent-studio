/**
 * Shared MCP tool primitives.
 *
 * These types are intentionally dependency-light: they describe a tool's
 * metadata and handler shape without binding to a transport, so both the core
 * registry and the plugin contract can import them.
 *
 * @module common/mcp/types
 */

import type * as z from 'zod/v4';

/**
 * Declarative description of an MCP tool.
 *
 * @typeParam TSchema - The Zod schema describing the tool's arguments.
 */
export interface ToolDefinition<TSchema extends z.ZodType = z.ZodType> {
  /** Unique tool name exposed over `tools/list`. */
  readonly name: string;
  /** Description shown to the model. */
  readonly description: string;
  /**
   * Zod schema for the arguments. MCP v2 derives the JSON Schema advertised to
   * the model from this, validates incoming arguments against it **before** the
   * handler runs, and infers the handler's argument type.
   */
  readonly inputSchema: TSchema;
}

/** A single content block returned by a tool. */
export interface TextContentBlock {
  readonly type: 'text';
  readonly text: string;
}

/**
 * Result of a tool invocation, matching the MCP v2 `CallToolResult` shape.
 * Validation failures surface as `isError: true`, never as a thrown error.
 */
export interface ToolResult {
  readonly content: readonly TextContentBlock[];
  readonly isError?: boolean;
}

/**
 * A notification a tool handler may send back to the client while it is still
 * running. `method` is a custom extension method (e.g. `notifications/agent/stream`);
 * `params` is whatever the extension defines. The SDK's own spec notifications
 * are left to the SDK — this type exists so a handler can stream out-of-band
 * progress without knowing the transport.
 */
export interface ToolNotification {
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

/**
 * Context handed to a tool handler alongside the validated arguments.
 *
 * It currently exposes exactly one capability — {@link ToolContext.notify},
 * which forwards a notification on the channel the request arrived on. That is
 * what lets a long-running tool (the agent) stream progress to the UI instead of
 * answering all at once.
 */
export interface ToolContext {
  readonly notify: (notification: ToolNotification) => void | Promise<void>;
}

/**
 * A tool handler. Arguments are validated by the SDK against the tool's
 * `inputSchema` before this runs, so the inferred type is trustworthy.
 *
 * The optional {@link ToolContext} is the escape hatch for handlers that need to
 * speak to the client mid-call; handlers that only answer can ignore it.
 *
 * @typeParam TSchema - The Zod schema of the owning {@link ToolDefinition}.
 */
export type ToolHandler<TSchema extends z.ZodType = z.ZodType> = (
  args: z.infer<TSchema>,
  ctx?: ToolContext,
) => Promise<ToolResult> | ToolResult;

/**
 * Type-erased handler used by the in-memory tool registry.
 *
 * The registry holds tools with different schemas in a single map, so the stored
 * handler must accept anything. Type safety is preserved at the **public API
 * boundary** — `InternalMCPServer.registerTool`, `registerDynamicTool` and
 * `PluginContext.registerTool` are all generic over the schema — while the
 * storage layer erases the argument type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolHandler = (args: any, ctx?: ToolContext) => Promise<ToolResult> | ToolResult;

/**
 * A tool definition paired with its handler, as produced by the tool factories.
 */
export interface ToolRegistration {
  readonly definition: ToolDefinition;
  readonly handler: AnyToolHandler;
}

/** Convenience constructor for a successful text result. */
export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Convenience constructor for a failed text result (`isError: true`). */
export function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** Convenience constructor for a JSON result. */
export function jsonResult(value: unknown): ToolResult {
  return textResult(JSON.stringify(value, null, 2));
}
