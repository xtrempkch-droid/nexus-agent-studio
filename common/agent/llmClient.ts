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
