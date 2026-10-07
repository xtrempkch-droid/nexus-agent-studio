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

import {
  completeStream,
  type LlmMessage,
  type LlmStreamFetcher,
  type ProviderKind,
} from './llmClient.ts';

/** A tool the agent may call. */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  /**
   * The argument names the tool accepts, in the order its schema declares them.
   *
   * Used for one thing: when a call fails, the loop tells the model what the
   * tool actually expects. A small local model that invents an argument name
   * (`contents` for `content`) otherwise repeats the identical failing call until
   * the step budget is gone, and the raw validation error — which names the
   * *missing* field, not the wrong one — was not enough to break the loop in
   * practice.
   */
  readonly parameters?: readonly string[];
  /** Execute a call; returns a string that is fed back to the model. */
  execute(arguments_: unknown): Promise<string>;
}

/** How much the agent may do before asking a human. */
export type AgentMode = 'autonomous' | 'assisted';

/**
 * A progress event emitted while a turn runs, so the caller can stream it to
 * the UI instead of waiting for the whole answer.
 *
 * `answer_delta.text` is the best-effort **full** answer so far (the preview
 * extracted from the model's partially-streamed JSON), so a consumer only has to
 * replace the in-progress text rather than diff fragments. `tool_call` fires as
 * each tool is invoked, which is what turns a slow loop into visible activity.
 */
export type AgentProgressEvent =
  | { readonly type: 'answer_delta'; readonly text: string }
  | { readonly type: 'tool_call'; readonly tool: string };

/** Inputs for one agent turn, or for resuming a turn paused for approval. */
export interface AgentTurnRequest {
  /** Task for a fresh turn. Omitted when resuming. */
  readonly prompt?: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly kind: ProviderKind;
  readonly tools: readonly AgentTool[];
  readonly streamFetcher?: LlmStreamFetcher;
  readonly maxSteps?: number;
  readonly mode?: AgentMode;
  /** Called with progress events as the turn runs; optional (nothing streams when omitted). */
  readonly onProgress?: (event: AgentProgressEvent) => void;
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

/**
 * Default number of model round-trips before giving up.
 *
 * Exported because the `ask_agent` schema offers it to the caller: the budget is
 * a property of the task, not of the loop — a one-line question is fine in a few
 * steps while "create these files" needs one round trip per file — and only the
 * caller knows which it is sending. Duplicating the number in the tool would let
 * the advertised default drift from the one actually used.
 */
export const DEFAULT_MAX_STEPS = 6;

/**
 * Hard ceiling for a caller-supplied step budget.
 *
 * Each step is a full model round trip, so an unbounded budget is an unbounded
 * bill and, on a local model, an unbounded wait. High enough to be irrelevant for
 * real work, low enough that a typo cannot start a loop that never ends.
 */
export const MAX_MAX_STEPS = 50;

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

/**
 * Best-effort extraction of the answer string from a *partially* streamed JSON
 * body, for streaming display only.
 *
 * The final answer is parsed properly from the complete text (see
 * {@link parseJsonObject}); this is what lets the UI show the answer growing
 * token by token. It looks for `"answer"`, then a colon, then an opening quote,
 * and reads up to the closing unescaped quote, decoding the few JSON escapes a
 * short answer is likely to contain. `\uXXXX` sequences are not decoded — that
 * precision is reserved for the real parse at the end.
 */
function answerPreview(raw: string): string {
  const key = raw.indexOf('"answer"');
  if (key === -1) {
    return '';
  }
  const colon = raw.indexOf(':', key + '"answer"'.length);
  if (colon === -1) {
    return '';
  }
  const quote = raw.indexOf('"', colon + 1);
  if (quote === -1) {
    return '';
  }

  let result = '';
  for (let index = quote + 1; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === '\\' && index + 1 < raw.length) {
      const escaped = raw[index + 1];
      if (escaped === 'n') {
        result += '\n';
      } else if (escaped === 't') {
        result += '\t';
      } else if (escaped === 'r') {
        result += '\r';
      } else {
        result += escaped;
      }
      index += 1;
    } else if (character === '"') {
      break;
    } else {
      result += character;
    }
  }
  return result;
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

/** Whether a tool result is a failure, as `agentTools` prefixes them. */
function isFailure(result: string): boolean {
  return result.trimStart().startsWith('ERRO:');
}

/**
 * What the model is told after a failed call.
 *
 * The raw error is kept verbatim — it is what the tool actually said — and the
 * tool's expected arguments are appended when they are known, because the model
 * is usually one argument name away from succeeding.
 */
function failureFeedback(tool: AgentTool, result: string): string {
  const expected =
    tool.parameters === undefined || tool.parameters.length === 0
      ? ''
      : `\nA ferramenta "${tool.name}" espera exatamente estes argumentos: ${tool.parameters.join(', ')}.`;
  return `Resultado de ${tool.name}:\n${result}${expected}`;
}

/** Whether the same call just failed the same way twice in a row. */
function isRepeatedFailure(
  previous: { signature: string; error: string } | null,
  signature: string,
  error: string,
): boolean {
  return previous !== null && previous.signature === signature && previous.error === error;
}

/**
 * What the loop managed before it ran out of steps.
 *
 * A budget can run out after the work is done: a model that writes the files and
 * then wanders (`list_models`, an irrelevant command) never emits a final answer,
 * and reporting that as "não concluiu" is simply untrue — the files are on disk.
 * Naming the tools that answered lets the user judge for themselves.
 */
function completedSummary(completed: readonly string[]): string {
  return completed.length === 0
    ? ''
    : `\n\nFerramentas que responderam com sucesso: ${completed.join(', ')}.`;
}

/**
 * What to say when the loop ran out of steps.
 *
 * Two different situations share the budget: the model kept working without
 * giving a final answer (often after doing the job — report it so the user does
 * not repeat it), or it stopped right after a call failed, in which case a bigger
 * budget repeats the same error and saying so is the useful part.
 */
function exhaustedMessage(
  lastCall: { tool: string; error: string | null } | null,
  completed: readonly string[],
): string {
  const summary = completedSummary(completed);

  if (lastCall !== null && lastCall.error !== null) {
    // Both readings are possible here and the loop cannot tell them apart: the
    // call may have failed because the model was mid-exploration (asking for a
    // file it has not written yet) and just needed more steps, or because the call
    // itself is wrong. Claiming either one would be a guess, so both are offered —
    // the *repeat* guard below is where the strong claim is earned.
    return (
      `O agente parou no limite de passos logo depois de uma chamada que falhou ` +
      `("${lastCall.tool}"):\n\n${lastCall.error}\n\n` +
      'Se ele só precisava de mais passos, aumente "Máximo de passos"; se o mesmo erro ' +
      'se repetir sempre, aumentar não resolve — corrija o argumento ou reformule a tarefa.' +
      summary
    );
  }

  return (
    `O agente atingiu o limite de passos sem dar uma resposta final.${summary}` +
    (completed.length === 0
      ? ' Tente uma tarefa menor ou aumente o limite.'
      : ' Se ele já fez o que você pediu, confira o resultado antes de repetir a tarefa;' +
        ' para tarefas com vários passos, aumente "Máximo de passos" nas configurações.')
  );
}

/**
 * A stable fingerprint of one tool call, for spotting a repeated failure.
 *
 * Serialised rather than compared by reference so the check works across steps,
 * where each step parses a fresh object. A tool that takes no arguments
 * serialises to `{}` and still fingerprints consistently.
 */
function callSignature(toolName: string, arguments_: unknown): string {
  let serialised: string;
  try {
    serialised = JSON.stringify(arguments_) ?? 'undefined';
  } catch {
    // A cyclic or otherwise unserialisable argument cannot be compared; giving it
    // its own bucket is the safe answer (it simply never matches another call).
    serialised = `unserialisable:${String(arguments_)}`;
  }
  return `${toolName}:${serialised}`;
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
  // Clamped here as well as in the tool schema: every step is a model round trip,
  // so a caller that reaches this function directly (a test, a plugin) must not be
  // able to start a loop that never ends.
  const maxSteps = Math.min(
    MAX_MAX_STEPS,
    Math.max(1, Math.floor(request.maxSteps ?? DEFAULT_MAX_STEPS)),
  );
  const mode = request.mode ?? 'autonomous';
  const toolsByName = new Map<string, AgentTool>();
  for (const tool of request.tools) {
    toolsByName.set(tool.name, tool);
  }

  const steps: AgentStep[] = [];

  /**
   * The last failed call, so an identical repeat can be spotted.
   *
   * `signature` is the tool name plus its arguments; `error` is the result text.
   * Both must match, because the same call failing *differently* means something
   * changed and another attempt is worth it.
   */
  let previousFailure: { signature: string; error: string } | null = null;
  /**
   * The most recent tool call, success or failure.
   *
   * Which one it was decides what advice is honest at the end: blaming a failure
   * that the model already recovered from ("corrija o argumento") points at the
   * wrong thing, so the failure is only reported when it really was the last word.
   */
  let lastCall: { tool: string; error: string | null } | null = null;
  /** Tools that answered successfully, in order, for the end-of-budget report. */
  const completed: string[] = [];

  let messages: LlmMessage[];
  if (request.history !== undefined) {
    // Resuming a paused turn: apply the human's decision to the pending tool,
    // then let the model continue from the conversation we already had.
    messages = [...request.history];
    if (request.decision !== undefined && request.assistantJson !== undefined) {
      messages.push({ role: 'assistant', content: request.assistantJson });
      if (request.decision === 'approve' && request.pendingTool !== undefined) {
        request.onProgress?.({ type: 'tool_call', tool: request.pendingTool });
      }
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
    let raw = '';
    const content = await completeStream(
      request.kind,
      request.baseUrl,
      request.model,
      messages,
      (delta) => {
        raw += delta;
        const preview = answerPreview(raw);
        if (preview !== '') {
          request.onProgress?.({ type: 'answer_delta', text: preview });
        }
      },
      request.streamFetcher,
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

    // Report the tool the model asked for, whatever happens next (executed,
    // corrected, or paused for approval) — this is the real-time signal that a
    // slow loop is still making progress.
    request.onProgress?.({ type: 'tool_call', tool: toolName });

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

    if (isFailure(result)) {
      const signature = callSignature(toolName, arguments_);
      // One retry is allowed on purpose: a transient failure (a timeout, a
      // container hiccup) can succeed the second time. The same call failing the
      // same way twice is not transient — it is the model repeating itself, and
      // spending the rest of the budget on it only delays the bad news.
      if (isRepeatedFailure(previousFailure, signature, result)) {
        steps.push({ action: 'tool', text: toolName });
        return {
          status: 'done',
          answer:
            `A chamada a "${toolName}" falhou duas vezes seguidas com os mesmos argumentos e o mesmo erro, ` +
            `então parei em vez de gastar o resto do orçamento repetindo-a. Erro:\n\n${result}` +
            (tool.parameters === undefined || tool.parameters.length === 0
              ? ''
              : `\n\nA ferramenta espera exatamente estes argumentos: ${tool.parameters.join(', ')}.`) +
            completedSummary(completed),
          steps,
        };
      }
      previousFailure = { signature, error: result };
      lastCall = { tool: toolName, error: result };
    } else {
      previousFailure = null;
      lastCall = { tool: toolName, error: null };
      completed.push(toolName);
    }

    messages.push({
      role: 'user',
      content: isFailure(result) ? failureFeedback(tool, result) : `Resultado de ${toolName}:\n${result}`,
    });
    steps.push({ action: 'tool', text: toolName });
  }

  return {
    status: 'done',
    answer: exhaustedMessage(lastCall, completed),
    steps,
  };
}
