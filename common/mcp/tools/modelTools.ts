/**
 * Model-listing tool for the UI's AI-provider settings.
 *
 * The settings panel has a "sincronizar" action that discovers which models a
 * provider exposes. Both payload shapes were verified against a live server:
 *
 * - Ollama `/api/tags`:
 *   `{ "models": [{ "name": "deepseek-r1:1.5b" }] }`
 * - OpenAI-compatible `/v1/models`:
 *   `{ "object": "list", "data": [{ "id": "deepseek-r1:1.5b" }] }`
 *
 * `fetch` is injected so the parsing and the URL construction are testable
 * without a model server on the test machine.
 *
 * @module common/mcp/tools/modelTools
 */

import * as z from 'zod/v4';
import { errorResult, jsonResult, type AnyToolHandler, type ToolRegistration } from '../types.ts';

/** Provider kinds the settings panel can talk to. */
export type ProviderKind = 'ollama' | 'openai';

/** The one capability this module needs from the network, injectable for tests. */
export type FetchLike = (url: string) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

const defaultFetch: FetchLike = (url) => fetch(url);

/** Which endpoint lists models for a given provider kind. */
export function modelsUrl(kind: ProviderKind, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/u, '');
  return kind === 'ollama' ? `${base}/api/tags` : `${base}/v1/models`;
}

/** Pull model names out of either documented payload. */
function extractModelNames(kind: ProviderKind, payload: unknown): string[] {
  if (kind === 'ollama') {
    const list = (payload as { readonly models?: readonly { readonly name?: unknown }[] } | null)
      ?.models ?? [];
    return list
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === 'string');
  }
  const list = (payload as { readonly data?: readonly { readonly id?: unknown }[] } | null)
    ?.data ?? [];
  return list.map((entry) => entry.id).filter((id): id is string => typeof id === 'string');
}

/** List the model names a provider exposes. Throws when the server refuses. */
export async function listModelsFor(
  kind: ProviderKind,
  baseUrl: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<string[]> {
  const response = await fetchImpl(modelsUrl(kind, baseUrl));
  if (!response.ok) {
    throw new Error(`o servidor respondeu HTTP ${response.status}`);
  }
  const payload = await response.json();
  return extractModelNames(kind, payload);
}

/** The `list_models` tool registration, with `fetch` injectable for tests. */
export function createModelTools(fetchImpl: FetchLike = defaultFetch): ToolRegistration[] {
  const definition = {
    name: 'list_models',
    description:
      'List the model names exposed by a model server (Ollama or OpenAI-compatible).',
    inputSchema: z.object({
      kind: z.enum(['ollama', 'openai']).default('ollama'),
      baseUrl: z.string().default('http://localhost:11434'),
    }),
  };

  const handler: AnyToolHandler = async ({ kind, baseUrl }) => {
    try {
      const models = await listModelsFor(kind, baseUrl, fetchImpl);
      return jsonResult({ kind, baseUrl, count: models.length, models });
    } catch (error) {
      return errorResult(`Falha ao listar modelos em ${baseUrl}: ${(error as Error).message}`);
    }
  };

  return [{ definition, handler }];
}
