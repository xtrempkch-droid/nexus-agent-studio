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
import { runAgentTurn, type AgentProgressEvent, type AgentTool } from './agentLoop.ts';
import type { LlmStreamFetcher } from './llmClient.ts';

/** A streaming fetcher that plays back a scripted sequence of assistant responses. */
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

/** Wrap one assistant fragment as a single Ollama NDJSON stream event. */
function ndjson(content: string): string {
  return `${JSON.stringify({ message: { role: 'assistant', content } })}\n`;
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
      streamFetcher: scriptedFetcher(
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
      streamFetcher: scriptedFetcher(
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
      streamFetcher: scriptedFetcher('não sei o que fazer'),
    });

    expect(turn.answer).toBe('não sei o que fazer');
    expect(turn.steps[0]?.action).toBe('fallback');
  });

  it('parses JSON even when the model wraps it in prose', async () => {
    const turn = await runAgentTurn({
      ...BASE,
      tools: [],
      streamFetcher: scriptedFetcher('Certo, aqui vai: {"answer":"finalizado"} obrigado'),
    });

    expect(turn.answer).toBe('finalizado');
  });

  it('gives up after the step budget instead of running forever', async () => {
    const turn = await runAgentTurn({
      ...BASE,
      tools: [],
      maxSteps: 3,
      streamFetcher: scriptedFetcher('{"tool":"nope","arguments":{}}'),
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
      streamFetcher: scriptedFetcher('{"tool":"read_file","arguments":{"path":"x"}}', '{"answer":"ok"}'),
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
      streamFetcher: scriptedFetcher('{"tool":"write_file","arguments":{"path":"a.ts","content":"x"}}'),
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
      streamFetcher: scriptedFetcher('{"tool":"read_file","arguments":{}}', '{"answer":"ok"}'),
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
      streamFetcher: scriptedFetcher('{"tool":"write_file","arguments":{"path":"a.ts"}}'),
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
      streamFetcher: scriptedFetcher('{"answer":"feito"}'),
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
      streamFetcher: scriptedFetcher('{"tool":"write_file","arguments":{}}'),
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
      streamFetcher: scriptedFetcher('{"answer":"entendido"}'),
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
      streamFetcher: scriptedFetcher('{"tool":"write_file","arguments":{}}', '{"answer":"feito"}'),
    });

    expect(turn.status).toBe('done');
    expect(turn.answer).toBe('feito');
    expect(calls).toEqual(['write_file({})']);
  });

  it('streams answer deltas as the answer grows', async () => {
    const events: AgentProgressEvent[] = [];
    const fetcher: LlmStreamFetcher = async () => ({
      ok: true,
      status: 200,
      chunks: (async function* () {
        yield ndjson('{"answer":"ol');
        yield ndjson('á');
        yield ndjson(' mundo"}');
      })(),
    });

    const turn = await runAgentTurn({
      ...BASE,
      tools: [],
      onProgress: (event) => events.push(event),
      streamFetcher: fetcher,
    });

    expect(turn.answer).toBe('olá mundo');
    expect(
      events.filter((event) => event.type === 'answer_delta').map((event) => event.text),
    ).toEqual(['ol', 'olá', 'olá mundo']);
  });

  it('emits tool_call progress events as tools run', async () => {
    const calls: string[] = [];
    const events: AgentProgressEvent[] = [];

    const turn = await runAgentTurn({
      ...BASE,
      tools: [tool('read_file', 'conteúdo', calls)],
      onProgress: (event) => events.push(event),
      streamFetcher: scriptedFetcher(
        '{"tool":"read_file","arguments":{"path":"a.ts"}}',
        '{"answer":"ok"}',
      ),
    });

    expect(turn.answer).toBe('ok');
    expect(
      events.filter((event) => event.type === 'tool_call').map((event) => event.tool),
    ).toEqual(['read_file']);
  });
});

/**
 * A fetcher that records the request bodies, so the corrective feedback the model
 * receives can be asserted — the point of this group is what the model is *told*,
 * which the scripted fetcher above throws away.
 */
function recordingFetcher(...responses: string[]): {
  readonly fetcher: LlmStreamFetcher;
  readonly bodies: unknown[];
} {
  const bodies: unknown[] = [];
  let index = 0;
  return {
    bodies,
    fetcher: async (_url, body) => {
      bodies.push(body);
      const content = responses[Math.min(index, responses.length - 1)] ?? '';
      index += 1;
      return {
        ok: true,
        status: 200,
        chunks: (async function* () {
          yield ndjson(content);
        })(),
      };
    },
  };
}

/** The `messages` array of the nth request the fetcher saw. */
function messagesOf(bodies: readonly unknown[], index: number): { role: string; content: string }[] {
  const body = bodies[index] as { messages?: { role: string; content: string }[] } | undefined;
  return body?.messages ?? [];
}

/** A tool that always fails the same way, with its argument names declared. */
function alwaysFailing(parameters: readonly string[]): AgentTool {
  return {
    name: 'write_file',
    description: 'escreve um arquivo',
    parameters,
    execute: async () => 'ERRO: Input validation error: content: expected string, received undefined',
  };
}

const REPEATED_CALL = '{"tool":"write_file","arguments":{"path":"a.py","contents":"x"}}';

describe('a failing tool call', () => {
  it('stops after repeating the identical failure instead of burning the budget', async () => {
    // The real case this comes from: a small local model invented `contents` for
    // `content`, called six identical times, and the turn ended blaming the step
    // limit. Two identical failures are enough to know another attempt will not
    // help; the budget is reserved for something else.
    const turn = await runAgentTurn({
      ...BASE,
      tools: [alwaysFailing(['path', 'content'])],
      maxSteps: 6,
      streamFetcher: scriptedFetcher(REPEATED_CALL),
    });

    expect(turn.steps).toHaveLength(2);
    expect(turn.answer).toContain('write_file');
    expect(turn.answer).toContain('duas vezes seguidas');
    expect(turn.answer).toContain('content: expected string');
    // And it says what the tool wanted, which is the part the model got wrong.
    expect(turn.answer).toContain('path, content');
  });

  it('tells the model which arguments the tool expects', async () => {
    const { fetcher, bodies } = recordingFetcher(REPEATED_CALL);

    await runAgentTurn({
      ...BASE,
      tools: [alwaysFailing(['path', 'content'])],
      streamFetcher: fetcher,
    });

    // Request 0 is the first attempt; request 1 carries the feedback from it.
    const feedback = messagesOf(bodies, 1).map((message) => message.content).join('\n');
    expect(feedback).toContain('Resultado de write_file');
    expect(feedback).toContain('content: expected string');
    expect(feedback).toContain('espera exatamente estes argumentos: path, content');
  });

  it('keeps going when the same call fails differently', async () => {
    // A second attempt is worth it when something changed — a timeout or a
    // transient error looks like this, and stopping on it would be wrong. Every
    // attempt fails with its own message here, so nothing ever repeats.
    const seen: string[] = [];
    let attempt = 0;
    const flaky: AgentTool = {
      name: 'write_file',
      description: 'escreve um arquivo',
      parameters: ['path', 'content'],
      execute: async () => {
        attempt += 1;
        seen.push(`attempt ${String(attempt)}`);
        return `ERRO: falha número ${String(attempt)}`;
      },
    };

    const turn = await runAgentTurn({
      ...BASE,
      tools: [flaky],
      maxSteps: 3,
      streamFetcher: scriptedFetcher(REPEATED_CALL),
    });

    expect(seen).toHaveLength(3);
    expect(turn.answer).not.toContain('duas vezes seguidas');
    expect(turn.answer).toContain('limite de passos');
  });

  it('offers both readings when the last call failed', async () => {
    // The loop cannot tell "it was mid-exploration and needed more steps" from
    // "this call is wrong", so it must not claim one. Each attempt differs here so
    // the repeat-guard stays out of the way.
    let attempt = 0;
    const varying: AgentTool = {
      name: 'write_file',
      description: 'escreve um arquivo',
      parameters: ['path', 'content'],
      execute: async () => {
        attempt += 1;
        return `ERRO: falha número ${String(attempt)}`;
      },
    };

    const turn = await runAgentTurn({
      ...BASE,
      tools: [varying],
      maxSteps: 3,
      streamFetcher: scriptedFetcher(REPEATED_CALL),
    });

    expect(turn.steps).toHaveLength(3);
    expect(turn.answer).toContain('limite de passos');
    expect(turn.answer).toContain('write_file');
    expect(turn.answer).toContain('falha número 3');
    expect(turn.answer).toContain('Se ele só precisava de mais passos');
    expect(turn.answer).not.toContain('só repete o mesmo erro');
  });

  it('reports what succeeded when the budget runs out after the work was done', async () => {
    // The real case: a model wrote the three files, then wandered into
    // `list_models` and a pointless command, and never emitted a final answer.
    // Saying "não concluiu" there is untrue — the files are on disk.
    const calls: string[] = [];
    const turn = await runAgentTurn({
      ...BASE,
      tools: [tool('write_file', '{"created":true}', calls)],
      maxSteps: 2,
      streamFetcher: scriptedFetcher('{"tool":"write_file","arguments":{"path":"a.py"}}'),
    });

    expect(turn.answer).toContain('limite de passos');
    expect(turn.answer).toContain('write_file, write_file');
    expect(turn.answer).toContain('confira o resultado antes de repetir a tarefa');
    // And it must NOT claim the task failed.
    expect(turn.answer).not.toContain('sem concluir');
  });

  it('does not blame a failure the model already recovered from', async () => {
    // From a real trace: the model used `text` instead of `content` (validation
    // error), then corrected itself and wrote the file, then wandered until the
    // budget ran out. Reporting the early failure as the reason would point at
    // the wrong thing — the advice must match what actually happened last.
    let attempt = 0;
    const flaky: AgentTool = {
      name: 'write_file',
      description: 'escreve um arquivo',
      parameters: ['path', 'content'],
      execute: async () => {
        attempt += 1;
        return attempt === 1 ? 'ERRO: content: expected string, received undefined' : '{"created":true}';
      },
    };

    const turn = await runAgentTurn({
      ...BASE,
      tools: [flaky],
      maxSteps: 3,
      streamFetcher: scriptedFetcher(REPEATED_CALL),
    });

    expect(turn.answer).toContain('limite de passos sem dar uma resposta final');
    expect(turn.answer).toContain('Ferramentas que responderam com sucesso: write_file');
    expect(turn.answer).not.toContain('corrija o argumento');
    expect(turn.answer).not.toContain('content: expected string');
  });

  it('keeps the plain advice when the budget ran out with nothing to show', async () => {
    // Only unknown tools were asked for, so there is no partial work to report.
    const turn = await runAgentTurn({
      ...BASE,
      tools: [],
      maxSteps: 2,
      streamFetcher: scriptedFetcher('{"tool":"nope","arguments":{}}'),
    });

    expect(turn.answer).toContain('limite de passos sem dar uma resposta final');
    expect(turn.answer).toContain('Tente uma tarefa menor ou aumente o limite');
    expect(turn.answer).not.toContain('Ferramentas que responderam');
  });
});
