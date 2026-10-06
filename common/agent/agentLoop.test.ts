/**
 * Tests for the agent turn.
 *
 * The fetcher and the tools are both injected, so nothing here touches a model
 * or the filesystem. What is asserted is the loop's discipline: it executes what
 * the model asks for, feeds the result back, stops on an answer, does not hang
 * on garbage, and respects the step budget.
 *
 * @module common/agent/agentLoop.test
 */

import { describe, expect, it } from 'vitest';
import { runAgentTurn, type AgentTool } from './agentLoop.ts';
import type { LlmFetcher } from './llmClient.ts';

/** A fetcher that plays back a scripted sequence of assistant responses. */
function scriptedFetcher(...responses: string[]): LlmFetcher {
  let index = 0;
  return async () => ({
    ok: true,
    status: 200,
    json: async () => {
      const content = responses[Math.min(index, responses.length - 1)] ?? '';
      index += 1;
      return { message: { role: 'assistant', content } };
    },
  });
}

function tool(name: string, output: string, calls: string[]): AgentTool {
  return {
    name,
    description: `${name} description`,
    execute: async (arguments_) => {
      calls.push(`${name}(${JSON.stringify(arguments_)})`);
      return output;
    },
  };
}

const BASE = {
  prompt: 'faça X',
  model: 'm',
  baseUrl: 'http://x',
  kind: 'ollama' as const,
};

describe('runAgentTurn', () => {
  it('executes a tool call and returns the final answer', async () => {
    const calls: string[] = [];
    const tools = [tool('read_file', 'conteúdo do arquivo', calls)];

    const turn = await runAgentTurn({
      ...BASE,
      tools,
      fetcher: scriptedFetcher(
        '{"tool":"read_file","arguments":{"path":"src/a.ts"}}',
        '{"answer":"pronto"}',
      ),
    });

    expect(calls).toEqual(['read_file({"path":"src/a.ts"})']);
    expect(turn.answer).toBe('pronto');
    expect(turn.steps.map((step) => step.action)).toEqual(['tool', 'answer']);
  });

  it('feeds an unknown tool name back instead of crashing', async () => {
    const calls: string[] = [];
    const turn = await runAgentTurn({
      ...BASE,
      tools: [tool('read_file', 'x', calls)],
      fetcher: scriptedFetcher(
        '{"tool":"destroy_everything","arguments":{}}',
        '{"answer":"desculpe"}',
      ),
    });

    expect(calls).toEqual([]);
    expect(turn.answer).toBe('desculpe');
    expect(turn.steps[0]?.action).toBe('tool');
    expect(turn.steps[0]?.text).toBe('destroy_everything');
  });

  it('returns raw text instead of looping when the model ignores the JSON contract', async () => {
    const turn = await runAgentTurn({
      ...BASE,
      tools: [],
      fetcher: scriptedFetcher('não sei o que fazer'),
    });

    expect(turn.answer).toBe('não sei o que fazer');
    expect(turn.steps[0]?.action).toBe('fallback');
  });

  it('parses JSON even when the model wraps it in prose', async () => {
    const turn = await runAgentTurn({
      ...BASE,
      tools: [],
      fetcher: scriptedFetcher('Certo, aqui vai: {"answer":"finalizado"} obrigado'),
    });

    expect(turn.answer).toBe('finalizado');
  });

  it('gives up after the step budget instead of running forever', async () => {
    const turn = await runAgentTurn({
      ...BASE,
      tools: [],
      maxSteps: 3,
      fetcher: scriptedFetcher('{"tool":"nope","arguments":{}}'),
    });

    expect(turn.steps).toHaveLength(3);
    expect(turn.answer).toContain('limite de passos');
  });

  it('surfaces a tool error as its result so the model can correct itself', async () => {
    const calls: string[] = [];
    const failing = tool('read_file', 'nunca', calls);
    const broken: AgentTool = {
      ...failing,
      execute: async () => {
        calls.push('read_file(threw)');
        throw new Error('arquivo não existe');
      },
    };

    const turn = await runAgentTurn({
      ...BASE,
      tools: [broken],
      fetcher: scriptedFetcher('{"tool":"read_file","arguments":{"path":"x"}}', '{"answer":"ok"}'),
    });

    expect(calls).toContain('read_file(threw)');
    expect(turn.answer).toBe('ok');
  });

  it('pauses in assisted mode before a dangerous tool instead of executing it', async () => {
    const calls: string[] = [];

    const turn = await runAgentTurn({
      ...BASE,
      mode: 'assisted',
      tools: [tool('write_file', 'escrito', calls)],
      fetcher: scriptedFetcher('{"tool":"write_file","arguments":{"path":"a.ts","content":"x"}}'),
    });

    expect(turn.status).toBe('needs_approval');
    expect(turn.tool).toBe('write_file');
    expect(calls).toEqual([]);
    expect(turn.history).toBeDefined();
    expect(turn.assistantJson).toBeDefined();
  });

  it('does not pause for a read-only tool in assisted mode', async () => {
    const calls: string[] = [];

    const turn = await runAgentTurn({
      ...BASE,
      mode: 'assisted',
      tools: [tool('read_file', 'conteúdo', calls)],
      fetcher: scriptedFetcher('{"tool":"read_file","arguments":{}}', '{"answer":"ok"}'),
    });

    expect(turn.status).toBe('done');
    expect(calls).toEqual(['read_file({})']);
  });

  it('executes the pending tool after approval and continues', async () => {
    const calls: string[] = [];
    const paused = await runAgentTurn({
      ...BASE,
      mode: 'assisted',
      tools: [tool('write_file', 'escrito', calls)],
      fetcher: scriptedFetcher('{"tool":"write_file","arguments":{"path":"a.ts"}}'),
    });

    const resumed = await runAgentTurn({
      ...BASE,
      mode: 'assisted',
      tools: [tool('write_file', 'escrito', calls)],
      history: paused.history,
      assistantJson: paused.assistantJson,
      pendingTool: paused.tool,
      pendingArguments: paused.arguments,
      decision: 'approve',
      fetcher: scriptedFetcher('{"answer":"feito"}'),
    });

    expect(resumed.status).toBe('done');
    expect(resumed.answer).toBe('feito');
    expect(calls).toEqual(['write_file({"path":"a.ts"})']);
  });

  it('does not execute after a rejection, and continues', async () => {
    const calls: string[] = [];
    const paused = await runAgentTurn({
      ...BASE,
      mode: 'assisted',
      tools: [tool('write_file', 'escrito', calls)],
      fetcher: scriptedFetcher('{"tool":"write_file","arguments":{}}'),
    });

    const resumed = await runAgentTurn({
      ...BASE,
      mode: 'assisted',
      tools: [tool('write_file', 'escrito', calls)],
      history: paused.history,
      assistantJson: paused.assistantJson,
      pendingTool: paused.tool,
      pendingArguments: paused.arguments,
      decision: 'reject',
      fetcher: scriptedFetcher('{"answer":"entendido"}'),
    });

    expect(resumed.answer).toBe('entendido');
    expect(calls).toEqual([]);
  });

  it('never pauses in autonomous mode', async () => {
    const calls: string[] = [];

    const turn = await runAgentTurn({
      ...BASE,
      mode: 'autonomous',
      tools: [tool('write_file', 'escrito', calls)],
      fetcher: scriptedFetcher('{"tool":"write_file","arguments":{}}', '{"answer":"feito"}'),
    });

    expect(turn.status).toBe('done');
    expect(turn.answer).toBe('feito');
    expect(calls).toEqual(['write_file({})']);
  });
});
