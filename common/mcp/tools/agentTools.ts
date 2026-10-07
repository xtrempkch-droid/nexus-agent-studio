/**
 * The `ask_agent` tool: the agent exposed to the UI.
 *
 * The agent is built from the other tools, so it is registered last and is never
 * offered to itself — offering it would let the model recurse into a second
 * agent, which is at best wasteful and at worst a loop.
 *
 * The model, provider and base URL are arguments of the call, not construction
 * time: the core does not decide which model the user chose, the UI does, at the
 * moment it asks.
 *
 * @module common/mcp/tools/agentTools
 */

import * as z from 'zod/v4';
import {
  DEFAULT_MAX_STEPS,
  MAX_MAX_STEPS,
  runAgentTurn,
  type AgentProgressEvent,
  type AgentTool,
} from '../../agent/agentLoop.ts';
import type { LlmStreamFetcher } from '../../agent/llmClient.ts';
import {
  errorResult,
  jsonResult,
  type AnyToolHandler,
  type ToolContext,
  type ToolRegistration,
} from '../types.ts';

/** Dependencies for {@link createAgentTools}. */
export interface AgentToolsOptions {
  /** The tools the agent may call — everything except the agent itself. */
  readonly tools: readonly ToolRegistration[];
  /** Streaming fetcher override, used by tests to avoid the network. */
  readonly streamFetcher?: LlmStreamFetcher;
}

/**
 * The argument names a tool's schema declares.
 *
 * Read defensively because `ToolDefinition.inputSchema` is typed as the generic
 * `z.ZodType`: only objects have `shape`, and a future tool may use some other
 * schema. An unknown shape simply yields no names, which costs nothing — the
 * names are only used to make failure feedback actionable.
 */
function parameterNamesOf(schema: z.ZodType): readonly string[] {
  const shape = (schema as { shape?: unknown }).shape;
  return typeof shape === 'object' && shape !== null ? Object.keys(shape) : [];
}

/** Register the agent tool. */
export function createAgentTools(options: AgentToolsOptions): ToolRegistration[] {
  const definition = {
    name: 'ask_agent',
    description:
      'Ask the local agent to perform a task in the workspace. It may read and write files, list directories and run terminal commands.',
    inputSchema: z.object({
      prompt: z.string().optional().describe('The task for the agent (first call only).'),
      model: z.string().min(1).describe('Model name, e.g. deepseek-r1:1.5b.'),
      baseUrl: z.string().default('http://localhost:11434'),
      kind: z.enum(['ollama', 'openai']).default('ollama'),
      mode: z.enum(['autonomous', 'assisted']).default('autonomous'),
      history: z
        .array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() }))
        .optional(),
      assistantJson: z.string().optional(),
      pendingTool: z.string().optional(),
      pendingArguments: z.unknown().optional(),
      decision: z.enum(['approve', 'reject']).optional(),
      maxSteps: z
        .number()
        .int()
        .min(1)
        .max(MAX_MAX_STEPS)
        .default(DEFAULT_MAX_STEPS)
        .describe(
          'How many model round-trips the turn may use. Each step is one tool call, ' +
            'so a task that writes several files needs at least one step per file.',
        ),
    }),
  };

  const agentTools: readonly AgentTool[] = options.tools.map((tool) => ({
    name: tool.definition.name,
    description: tool.definition.description,
    parameters: parameterNamesOf(tool.definition.inputSchema),
    execute: async (arguments_) => {
      const result = await tool.handler(arguments_);
      const text = result.content.map((block) => block.text).join('\n');
      return result.isError === true ? `ERRO: ${text}` : text;
    },
  }));

  const handler: AnyToolHandler = async (args, ctx?: ToolContext) => {
    const {
      prompt,
      model,
      baseUrl,
      kind,
      mode,
      history,
      assistantJson,
      pendingTool,
      pendingArguments,
      decision,
      maxSteps,
    } = args;

    if (typeof prompt !== 'string' && history === undefined) {
      return errorResult('ask_agent precisa de "prompt" ou de "history" para continuar.');
    }

    // Progress events ride out on a notification on the same channel as the
    // request, so the UI can render the answer growing instead of waiting. When
    // there is no context (a direct in-process call), the events are dropped and
    // the turn still answers normally.
    const onProgress =
      ctx === undefined
        ? undefined
        : (event: AgentProgressEvent) => {
            void ctx.notify({
              method: 'notifications/agent/stream',
              params: event as unknown as Record<string, unknown>,
            });
          };

    try {
      const turn = await runAgentTurn({
        prompt,
        model,
        baseUrl,
        kind,
        mode,
        history,
        assistantJson,
        pendingTool,
        pendingArguments,
        decision,
        maxSteps,
        tools: agentTools,
        ...(onProgress === undefined ? {} : { onProgress }),
        ...(options.streamFetcher === undefined ? {} : { streamFetcher: options.streamFetcher }),
      });
      return jsonResult({
        status: turn.status,
        answer: turn.answer,
        toolCalls: turn.steps
          .filter((step) => step.action === 'tool')
          .map((step) => step.text),
        steps: turn.steps.length,
        ...(turn.status === 'needs_approval'
          ? {
              tool: turn.tool,
              arguments: turn.arguments,
              history: turn.history,
              assistantJson: turn.assistantJson,
            }
          : {}),
      });
    } catch (error) {
      return errorResult(`Falha ao executar o agente: ${(error as Error).message}`);
    }
  };

  return [{ definition, handler }];
}
