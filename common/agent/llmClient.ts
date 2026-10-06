/**
 * Minimal chat client for the agent.
 *
 * The agent only needs one capability from a model server: send a list of
 * messages and get one completion back. Both endpoints were verified against the
 * live local server, not assumed:
 *
 * - Ollama `POST /api/chat` with `{ stream: false, format: "json" }` answers
 *   `{ "message": { "role": "assistant", "content": "..." } }`.
 * - OpenAI-compatible `POST /v1/chat/completions` answers
 *   `{ "choices": [{ "message": { "role": "assistant", "content": "..." } }] }`.
 *
 * `format: "json"` is the Ollama flag that forces a well-formed JSON object out
 * of the model — the backbone of the prompt-based tool calling in
 * {@link ./agentLoop.ts}. The OpenAI-compatible path has no equivalent here, so
 * for that kind the JSON discipline is carried by the prompt alone.
 *
 * @module common/agent/llmClient
 */

export type ProviderKind = 'ollama' | 'openai';

/** A chat message, kept to the roles the agent actually uses. */
export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** The one capability this module needs from the network, injectable for tests. */
export type LlmFetcher = (
  url: string,
  body: unknown,
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

const defaultFetcher: LlmFetcher = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A streaming response: a status plus decoded text chunks as they arrive. */
export interface LlmStreamResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly chunks: AsyncIterable<string>;
}

/** The streaming counterpart of {@link LlmFetcher}, injectable for tests. */
export type LlmStreamFetcher = (url: string, body: unknown) => Promise<LlmStreamResponse>;

/** Decode a web stream into UTF-8 text chunks, splitting safely across boundaries. */
async function* decodeChunks(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    yield decoder.decode(value, { stream: true });
  }
  yield decoder.decode();
}

const defaultStreamFetcher: LlmStreamFetcher = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    ok: response.ok,
    status: response.status,
    chunks: response.body === null ? (async function* () {})() : decodeChunks(response.body),
  };
};

/** Which endpoint completes a chat for a given provider kind. */
export function chatUrl(kind: ProviderKind, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/u, '');
  return kind === 'ollama' ? `${base}/api/chat` : `${base}/v1/chat/completions`;
}

/** Build the request body for a provider kind. */
export function chatRequestBody(
  kind: ProviderKind,
  model: string,
  messages: readonly LlmMessage[],
): unknown {
  const plain = messages.map((message) => ({ role: message.role, content: message.content }));

  if (kind === 'ollama') {
    return { model, stream: false, format: 'json', messages: plain };
  }
  return { model, stream: false, messages: plain };
}

/**
 * Build the streaming request body.
 *
 * Same contract as {@link chatRequestBody} except `stream: true`. `format:
 * "json"` stays on the Ollama path: the model still has to honour the JSON
 * contract, and the deltas are the JSON being generated piece by piece.
 */
export function chatStreamRequestBody(
  kind: ProviderKind,
  model: string,
  messages: readonly LlmMessage[],
): unknown {
  const base = chatRequestBody(kind, model, messages) as Record<string, unknown>;
  return { ...base, stream: true };
}

/** Pull the assistant text out of either documented payload. */
function extractContent(kind: ProviderKind, payload: unknown): string {
  if (kind === 'ollama') {
    const content = (payload as { readonly message?: { readonly content?: unknown } } | null)
      ?.message?.content;
    return typeof content === 'string' ? content : '';
  }
  const content = (
    payload as {
      readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[];
    } | null
  )?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

/**
 * Send one chat turn and return the assistant's text.
 *
 * Throws when the server refuses or answers without content; both are failures
 * worth surfacing rather than treating an empty answer as a real one.
 */
export async function complete(
  kind: ProviderKind,
  baseUrl: string,
  model: string,
  messages: readonly LlmMessage[],
  fetcher: LlmFetcher = defaultFetcher,
): Promise<string> {
  const response = await fetcher(chatUrl(kind, baseUrl), chatRequestBody(kind, model, messages));
  if (!response.ok) {
    throw new Error(`o servidor respondeu HTTP ${response.status}`);
  }
  const content = extractContent(kind, await response.json());
  if (content.trim() === '') {
    throw new Error('o servidor respondeu sem conteúdo');
  }
  return content;
}

/** Pull the assistant fragment out of one Ollama NDJSON stream event. */
function ollamaDelta(line: string): string {
  if (line.trim() === '') {
    return '';
  }
  try {
    const parsed = JSON.parse(line) as { readonly message?: { readonly content?: unknown } };
    const content = parsed.message?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
}

/** Pull the assistant fragment out of one OpenAI-compatible SSE `data:` payload. */
function openAiDelta(dataLine: string): string {
  if (dataLine === '[DONE]') {
    return '';
  }
  try {
    const parsed = JSON.parse(dataLine) as {
      readonly choices?: readonly { readonly delta?: { readonly content?: unknown } }[];
    };
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
}

/**
 * Stream one chat turn, calling `onDelta` with each fragment of assistant text
 * as it arrives, and resolving with the full text once the stream ends.
 *
 * The framing differs per provider (Ollama is newline-delimited JSON, the
 * OpenAI-compatible path is Server-Sent Events); the loop below splits chunks
 * into lines and buffers a partial line across chunk boundaries, so a delta
 * split mid-line still parses.
 *
 * Throws when the server refuses. `onDelta` is called for every non-empty
 * fragment; the caller decides how to surface them.
 */
export async function completeStream(
  kind: ProviderKind,
  baseUrl: string,
  model: string,
  messages: readonly LlmMessage[],
  onDelta: (delta: string) => void,
  fetcher: LlmStreamFetcher = defaultStreamFetcher,
): Promise<string> {
  const response = await fetcher(chatUrl(kind, baseUrl), chatStreamRequestBody(kind, model, messages));
  if (!response.ok) {
    throw new Error(`o servidor respondeu HTTP ${response.status}`);
  }

  let full = '';
  let buffer = '';

  for await (const chunk of response.chunks) {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const raw = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

      // Ollama is one JSON event per line; the OpenAI-compatible path is SSE,
      // one `data:` payload per line and `[DONE]` for the terminator.
      const delta =
        kind === 'ollama'
          ? ollamaDelta(line)
          : line.startsWith('data:')
            ? openAiDelta(line.slice(5).trimStart())
            : '';

      if (delta !== '') {
        full += delta;
        onDelta(delta);
      }
    }
  }

  return full;
}
