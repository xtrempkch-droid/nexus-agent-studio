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

/** How much the agent may do before asking a human. */
export type AgentMode = 'autonomous' | 'assisted';

/** Inputs for one agent turn, or for resuming a turn paused for approval. */
export interface AgentTurnRequest {
  /** Task for a fresh turn. Omitted when resuming. */
  readonly prompt?: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly kind: ProviderKind;
  readonly tools: readonly AgentTool[];
  readonly fetcher?: LlmFetcher;
  readonly maxSteps?: number;
  readonly mode?: AgentMode;
  /** Conversation so far, passed back verbatim to resume a paused turn. */
  readonly history?: readonly LlmMessage[];
  /** The model output that requested the paused tool. */
  readonly assistantJson?: string;
  /** The tool that was paused, and the arguments it asked for. */
  readonly pendingTool?: string;
  readonly pendingArguments?: unknown;
  /** The human's answer to the pending tool. */
  readonly decision?: 'approve' | 'reject';
}

/** One recorded action the agent took. */
export interface AgentStep {
  readonly action: 'tool' | 'answer' | 'fallback';
  /** Tool name for `tool`; the answer text otherwise. */
  readonly text: string;
}

/** The outcome of one agent turn. */
export interface AgentTurnResult {
  /** `needs_approval` pauses a turn; `done` means the answer is final. */
  readonly status: 'done' | 'needs_approval';
  readonly answer: string;
  readonly steps: readonly AgentStep[];
  /** Populated when `status` is `needs_approval`, and fed back to resume. */
  readonly tool?: string;
  readonly arguments?: unknown;
  readonly history?: readonly LlmMessage[];
  readonly assistantJson?: string;
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

/** Tools that may mutate the machine, paused for approval in assisted mode. */
const DANGEROUS_TOOLS: ReadonlySet<string> = new Set(['write_file', 'run_terminal_command']);

/** Run a named tool, or report it missing. */
async function executeNamed(
  toolsByName: ReadonlyMap<string, AgentTool>,
  name: string | undefined,
  arguments_: unknown,
): Promise<string> {
  const tool = name === undefined ? undefined : toolsByName.get(name);
  if (tool === undefined) {
    return `A ferramenta "${name ?? '?'}" não existe.`;
  }
  return executeSafely(tool, arguments_);
}

/** Run one bounded agent turn. */
export async function runAgentTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
  const maxSteps = request.maxSteps ?? DEFAULT_MAX_STEPS;
  const mode = request.mode ?? 'autonomous';
  const toolsByName = new Map<string, AgentTool>();
  for (const tool of request.tools) {
    toolsByName.set(tool.name, tool);
  }

  const steps: AgentStep[] = [];

  let messages: LlmMessage[];
  if (request.history !== undefined) {
    // Resuming a paused turn: apply the human's decision to the pending tool,
    // then let the model continue from the conversation we already had.
    messages = [...request.history];
    if (request.decision !== undefined && request.assistantJson !== undefined) {
      messages.push({ role: 'assistant', content: request.assistantJson });
      const outcome =
        request.decision === 'approve'
          ? `Resultado de ${request.pendingTool ?? '?'}:\n${await executeNamed(
              toolsByName,
              request.pendingTool,
              request.pendingArguments ?? {},
            )}`
          : 'O usuário rejeitou esta ação.';
      messages.push({ role: 'user', content: outcome });
      steps.push({ action: 'tool', text: request.pendingTool ?? '?' });
    }
  } else {
    messages = [
      { role: 'system', content: buildSystemPrompt(request.tools) },
      { role: 'user', content: request.prompt ?? '' },
    ];
  }

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
      return { status: 'done', answer: content, steps };
    }

    const answer = parsed['answer'];
    if (typeof answer === 'string') {
      steps.push({ action: 'answer', text: answer });
      return { status: 'done', answer, steps };
    }

    const toolName = parsed['tool'];
    if (typeof toolName !== 'string') {
      steps.push({ action: 'fallback', text: content });
      return { status: 'done', answer: content, steps };
    }

    const tool = toolsByName.get(toolName);
    const arguments_ = parsed['arguments'] ?? {};

    if (mode === 'assisted' && DANGEROUS_TOOLS.has(toolName)) {
      // Pause instead of mutating. The pending assistant message is deliberately
      // not in `history`: it is returned separately and reinserted on resume, so
      // the order of messages stays exactly right.
      return {
        status: 'needs_approval',
        answer: '',
        steps,
        tool: toolName,
        arguments: arguments_,
        history: messages,
        assistantJson: content,
      };
    }

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

    const result = await executeSafely(tool, arguments_);
    messages.push({ role: 'user', content: `Resultado de ${toolName}:\n${result}` });
    steps.push({ action: 'tool', text: toolName });
  }

  return {
    status: 'done',
    answer:
      'O agente atingiu o limite de passos sem concluir. Tente uma tarefa menor ou aumente o limite.',
    steps,
  };
}
