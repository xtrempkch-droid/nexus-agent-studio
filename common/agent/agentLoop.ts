/**
 * The agent turn: prompt the model, execute the tools it asks for, repeat.
 *
 * Tool calling is done **through the prompt**, not through a provider's native
 * `tools` mechanism. The reason is deliberately recorded: native tool calling
 * needs a JSON Schema per tool and a model with a tool-calling template, and the
 * local `deepseek-r1:1.5b` — a reasoning distill — has neither. So the model is
 * told the tools in prose and asked to answer with one JSON object, and the
 * `format: "json"` flag (on Ollama) is what keeps that object parseable.
 *
 * The loop is bounded and every exit path is explicit: a tool call, a final
 * answer, an unparseable answer (treated as the answer rather than a hang), or
 * the step budget.
 *
 * @module common/agent/agentLoop
 */

import { complete, type LlmMessage, type LlmFetcher, type ProviderKind } from './llmClient.ts';

/** A tool the agent may call. */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  /** Execute a call; returns a string that is fed back to the model. */
  execute(arguments_: unknown): Promise<string>;
}

/** Inputs for one agent turn. */
export interface AgentTurnRequest {
  readonly prompt: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly kind: ProviderKind;
  readonly tools: readonly AgentTool[];
  readonly fetcher?: LlmFetcher;
  readonly maxSteps?: number;
}

/** One recorded action the agent took. */
export interface AgentStep {
  readonly action: 'tool' | 'answer' | 'fallback';
  /** Tool name for `tool`; the answer text otherwise. */
  readonly text: string;
}

/** The outcome of one agent turn. */
export interface AgentTurnResult {
  readonly answer: string;
  readonly steps: readonly AgentStep[];
}

/** Default number of model round-trips before giving up. */
const DEFAULT_MAX_STEPS = 6;

function buildSystemPrompt(tools: readonly AgentTool[]): string {
  const toolLines = tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');
  return (
    'Você é um assistente de programação operando um editor de código. ' +
    'Você tem acesso a estas ferramentas:\n' +
    `${toolLines}\n\n` +
    'Responda APENAS com um objeto JSON, sem nenhum texto ao redor:\n' +
    '- para chamar uma ferramenta: {"tool":"<nome>","arguments":{...}}\n' +
    '- para a resposta final: {"answer":"<texto>"}\n\n' +
    'Use o nome exato da ferramenta. Se um argumento estiver errado, a ferramenta ' +
    'responderá com erro e você pode tentar de novo com os argumentos corretos.'
  );
}

/** Parse a JSON object even when the model wrapped it in prose or code fences. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function executeSafely(tool: AgentTool, arguments_: unknown): Promise<string> {
  try {
    return await tool.execute(arguments_);
  } catch (error) {
    return `ERRO: ${(error as Error).message}`;
  }
}

/** Run one bounded agent turn. */
export async function runAgentTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
  const maxSteps = request.maxSteps ?? DEFAULT_MAX_STEPS;
  const toolsByName = new Map<string, AgentTool>();
  for (const tool of request.tools) {
    toolsByName.set(tool.name, tool);
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: buildSystemPrompt(request.tools) },
    { role: 'user', content: request.prompt },
  ];

  const steps: AgentStep[] = [];

  for (let index = 0; index < maxSteps; index += 1) {
    const content = await complete(
      request.kind,
      request.baseUrl,
      request.model,
      messages,
      request.fetcher,
    );

    const parsed = parseJsonObject(content);

    if (parsed === null) {
      // The model did not honour the JSON contract. Looping here would mostly
      // burn the budget on an uncooperative model, so the raw text is the answer.
      steps.push({ action: 'fallback', text: content });
      return { answer: content, steps };
    }

    const answer = parsed['answer'];
    if (typeof answer === 'string') {
      steps.push({ action: 'answer', text: answer });
      return { answer, steps };
    }

    const toolName = parsed['tool'];
    if (typeof toolName !== 'string') {
      steps.push({ action: 'fallback', text: content });
      return { answer: content, steps };
    }

    const tool = toolsByName.get(toolName);
    messages.push({ role: 'assistant', content });

    if (tool === undefined) {
      messages.push({
        role: 'user',
        content: `A ferramenta "${toolName}" não existe. Disponíveis: ${request.tools
          .map((known) => known.name)
          .join(', ')}.`,
      });
      steps.push({ action: 'tool', text: toolName });
      continue;
    }

    const result = await executeSafely(tool, parsed['arguments'] ?? {});
    messages.push({ role: 'user', content: `Resultado de ${toolName}:\n${result}` });
    steps.push({ action: 'tool', text: toolName });
  }

  return {
    answer:
      'O agente atingiu o limite de passos sem concluir. Tente uma tarefa menor ou aumente o limite.',
    steps,
  };
}
