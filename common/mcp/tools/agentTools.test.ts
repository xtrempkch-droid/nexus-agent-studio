/**
 * Tests for the `ask_agent` tool wiring.
 *
 * The model is stubbed with a streaming fetcher, and the tool context is a
 * recorder, so nothing here touches a real model or the MCP transport. What is
 * asserted is the out-of-band channel: progress events become
 * `notifications/agent/stream` notifications on the context, and a call with no
 * context still completes normally.
 *
 * @module common/mcp/tools/agentTools.test
 */

import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import type { LlmStreamFetcher } from '../../agent/llmClient.ts';
import {
  textResult,
  type ToolContext,
  type ToolNotification,
  type ToolRegistration,
} from '../types.ts';
import { createAgentTools } from './agentTools.ts';

/** A single fake workspace tool the agent may call. */
const READ_TOOL: ToolRegistration = {
  definition: {
    name: 'read_file',
    description: 'lê um arquivo',
    inputSchema: z.object({ path: z.string() }),
  },
  handler: async () => textResult('conteúdo'),
};

/** Wrap one assistant fragment as a single Ollama NDJSON stream event. */
function ndjson(content: string): string {
  return `${JSON.stringify({ message: { role: 'assistant', content } })}\n`;
}

/** A scripted streaming fetcher answering once per turn, wrapped as NDJSON. */
function scriptedFetcher(...responses: string[]): LlmStreamFetcher {
  let index = 0;
  return async () => {
    const content = responses[Math.min(index, responses.length - 1)] ?? '';
    index += 1;
    return {
      ok: true,
      status: 200,
      chunks: (async function* () {
        yield ndjson(content);
      })(),
    };
  };
}

/** A context that records every notification instead of sending it anywhere. */
function recordingContext(): { ctx: ToolContext; notifications: ToolNotification[] } {
  const notifications: ToolNotification[] = [];
  return {
    notifications,
    ctx: { notify: (notification) => void notifications.push(notification) },
  };
}

/** Unwrap the text of a tool result's first content block. */
function resultText(result: { readonly content: readonly { readonly text: string }[] }): string {
  return result.content[0]?.text ?? '';
}

describe('createAgentTools', () => {
  it('streams answer and tool progress as notifications', async () => {
    const [agent] = createAgentTools({
      tools: [READ_TOOL],
      streamFetcher: scriptedFetcher(
        '{"tool":"read_file","arguments":{"path":"a.ts"}}',
        '{"answer":"olá"}',
      ),
    });
    if (agent === undefined) {
      throw new Error('createAgentTools returned no tool');
    }

    const { ctx, notifications } = recordingContext();
    const result = await agent.handler(
      { prompt: 'leia', model: 'm', baseUrl: 'http://x', kind: 'ollama' },
      ctx,
    );

    const parsed = JSON.parse(resultText(result)) as { answer: string };
    expect(parsed.answer).toBe('olá');
    expect(notifications.every((n) => n.method === 'notifications/agent/stream')).toBe(true);

    const kinds = notifications.map((n) => (n.params as { type: string }).type);
    expect(kinds).toContain('tool_call');
    expect(kinds).toContain('answer_delta');
  });

  it('answers normally without a context', async () => {
    const [agent] = createAgentTools({
      tools: [READ_TOOL],
      streamFetcher: scriptedFetcher('{"answer":"pronto"}'),
    });
    if (agent === undefined) {
      throw new Error('createAgentTools returned no tool');
    }

    const result = await agent.handler({
      prompt: 'faça',
      model: 'm',
      baseUrl: 'http://x',
      kind: 'ollama',
    });

    const parsed = JSON.parse(resultText(result)) as { answer: string };
    expect(parsed.answer).toBe('pronto');
  });
});
