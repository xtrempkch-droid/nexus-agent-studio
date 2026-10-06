/**
 * Tests for the model-listing tool.
 *
 * No network is touched: `fetch` is injected, so what is asserted is the URL
 * construction, the parsing of both documented payload shapes, and the honest
 * failure when the server refuses.
 *
 * @module common/mcp/tools/modelTools.test
 */

import { describe, expect, it } from 'vitest';
import {
  createModelTools,
  listModelsFor,
  modelsUrl,
  type FetchLike,
} from './modelTools.ts';

/** A stub `fetch` answering with a canned JSON body. */
function fetchWith(payload: unknown, ok = true, status = 200): FetchLike {
  return async () => ({ ok, status, json: async () => payload });
}

/** Unwrap the text of a tool result's first content block. */
function resultText(result: { readonly content: readonly { readonly text: string }[] }): string {
  return result.content[0]?.text ?? '';
}

describe('modelsUrl', () => {
  it('points at /api/tags for Ollama', () => {
    expect(modelsUrl('ollama', 'http://localhost:11434')).toBe('http://localhost:11434/api/tags');
  });

  it('points at /v1/models for OpenAI-compatible servers', () => {
    expect(modelsUrl('openai', 'http://localhost:11434')).toBe('http://localhost:11434/v1/models');
  });

  it('strips a trailing slash from the base URL', () => {
    expect(modelsUrl('ollama', 'http://localhost:11434/')).toBe('http://localhost:11434/api/tags');
  });
});

describe('listModelsFor', () => {
  it('parses the Ollama /api/tags shape', async () => {
    const models = await listModelsFor(
      'ollama',
      'http://x',
      fetchWith({ models: [{ name: 'deepseek-r1:1.5b' }, { name: 'qwen2.5:7b' }] }),
    );

    expect(models).toEqual(['deepseek-r1:1.5b', 'qwen2.5:7b']);
  });

  it('parses the OpenAI /v1/models shape', async () => {
    const models = await listModelsFor(
      'openai',
      'http://x',
      fetchWith({
        object: 'list',
        data: [{ id: 'gpt-4o', object: 'model' }, { id: 'gpt-4o-mini', object: 'model' }],
      }),
    );

    expect(models).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('ignores entries without a string name', async () => {
    const models = await listModelsFor(
      'ollama',
      'http://x',
      fetchWith({ models: [{ name: 'ok' }, { name: 42 }, {}] }),
    );

    expect(models).toEqual(['ok']);
  });

  it('throws when the server refuses', async () => {
    await expect(
      listModelsFor('ollama', 'http://x', fetchWith({}, false, 502)),
    ).rejects.toThrow('HTTP 502');
  });
});

describe('createModelTools', () => {
  it('reports the model list as JSON on success', async () => {
    const [tool] = createModelTools(fetchWith({ models: [{ name: 'deepseek-r1:1.5b' }] }));
    if (tool === undefined) {
      throw new Error('createModelTools returned no tool');
    }

    const result = await tool.handler({ kind: 'ollama', baseUrl: 'http://x' });
    const parsed = JSON.parse(resultText(result)) as { count: number; models: string[] };

    expect(parsed.count).toBe(1);
    expect(parsed.models).toEqual(['deepseek-r1:1.5b']);
  });

  it('reports an error result when the server refuses', async () => {
    const [tool] = createModelTools(fetchWith({}, false, 502));
    if (tool === undefined) {
      throw new Error('createModelTools returned no tool');
    }

    const result = await tool.handler({ kind: 'ollama', baseUrl: 'http://x' });

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('HTTP 502');
  });
});
