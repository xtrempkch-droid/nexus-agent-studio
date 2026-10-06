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
import { runAgentTurn, type AgentTool } from '../../agent/agentLoop.ts';
import { errorResult, jsonResult, type AnyToolHandler, type ToolRegistration } from '../types.ts';

/** Dependencies for {@link createAgentTools}. */
export interface AgentToolsOptions {
  /** The tools the agent may call — everything except the agent itself. */
  readonly tools: readonly ToolRegistration[];
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
    }),
  };

  const agentTools: readonly AgentTool[] = options.tools.map((tool) => ({
    name: tool.definition.name,
    description: tool.definition.description,
    execute: async (arguments_) => {
      const result = await tool.handler(arguments_);
      const text = result.content.map((block) => block.text).join('\n');
      return result.isError === true ? `ERRO: ${text}` : text;
    },
  }));

  const handler: AnyToolHandler = async (args) => {
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
    } = args;

    if (typeof prompt !== 'string' && history === undefined) {
      return errorResult('ask_agent precisa de "prompt" ou de "history" para continuar.');
    }

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
        tools: agentTools,
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
