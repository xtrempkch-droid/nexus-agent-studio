/**
 * Tests for the minimal chat client.
 *
 * No network is touched: the fetcher is injected, so what is asserted is the URL
 * and body construction for both providers and the parsing of both documented
 * payload shapes.
 *
 * @module common/agent/llmClient.test
 */

import { describe, expect, it } from 'vitest';
import {
  chatRequestBody,
  chatStreamRequestBody,
  chatUrl,
  complete,
  completeStream,
  type LlmFetcher,
  type LlmStreamFetcher,
} from './llmClient.ts';

const MESSAGES = [{ role: 'user' as const, content: 'olá' }];

function fetcherWith(payload: unknown, ok = true, status = 200): LlmFetcher {
  return async () => ({ ok, status, json: async () => payload });
}

/** A streaming fetcher yielding the given chunks, in order. */
function streamFetcher(chunks: string[], ok = true, status = 200): LlmStreamFetcher {
  return async () => ({ ok, status, chunks: (async function* () { for (const c of chunks) yield c; })() });
}

describe('chatUrl', () => {
  it('points Ollama at /api/chat and OpenAI-compatible at /v1/chat/completions', () => {
    expect(chatUrl('ollama', 'http://localhost:11434')).toBe('http://localhost:11434/api/chat');
    expect(chatUrl('openai', 'http://localhost:11434')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('strips a trailing slash', () => {
    expect(chatUrl('ollama', 'http://localhost:11434/')).toBe('http://localhost:11434/api/chat');
  });
});

describe('chatRequestBody', () => {
  it('forces JSON output on the Ollama path', () => {
    const body = chatRequestBody('ollama', 'm', MESSAGES) as {
      model: string;
      stream: boolean;
      format: string;
      messages: unknown[];
    };

    expect(body.model).toBe('m');
    expect(body.stream).toBe(false);
    expect(body.format).toBe('json');
    expect(body.messages).toEqual([{ role: 'user', content: 'olá' }]);
  });

  it('does not claim JSON support it cannot guarantee on the OpenAI path', () => {
    const body = chatRequestBody('openai', 'm', MESSAGES) as Record<string, unknown>;

    expect(body).not.toHaveProperty('format');
    expect(body.model).toBe('m');
  });
});

describe('complete', () => {
  it('parses the Ollama response shape', async () => {
    const content = await complete(
      'ollama',
      'http://x',
      'm',
      MESSAGES,
      fetcherWith({ message: { role: 'assistant', content: '{"answer":"ok"}' } }),
    );

    expect(content).toBe('{"answer":"ok"}');
  });

  it('parses the OpenAI-compatible response shape', async () => {
    const content = await complete(
      'openai',
      'http://x',
      'm',
      MESSAGES,
      fetcherWith({ choices: [{ message: { role: 'assistant', content: 'oi' } }] }),
    );

    expect(content).toBe('oi');
  });

  it('throws when the server refuses', async () => {
    await expect(
      complete('ollama', 'http://x', 'm', MESSAGES, fetcherWith({}, false, 500)),
    ).rejects.toThrow('HTTP 500');
  });

  it('throws when the server answers without content', async () => {
    await expect(
      complete('ollama', 'http://x', 'm', MESSAGES, fetcherWith({ message: { content: '' } })),
    ).rejects.toThrow('sem conteúdo');
  });
});

describe('chatStreamRequestBody', () => {
  it('turns streaming on while keeping the JSON format on the Ollama path', () => {
    const body = chatStreamRequestBody('ollama', 'm', MESSAGES) as {
      stream: boolean;
      format: string;
    };
    expect(body.stream).toBe(true);
    expect(body.format).toBe('json');
  });

  it('turns streaming on for the OpenAI-compatible path', () => {
    const body = chatStreamRequestBody('openai', 'm', MESSAGES) as { stream: boolean };
    expect(body.stream).toBe(true);
  });
});

describe('completeStream', () => {
  it('streams Ollama NDJSON fragments and resolves the full text', async () => {
    const deltas: string[] = [];
    const full = await completeStream(
      'ollama',
      'http://x',
      'm',
      MESSAGES,
      (delta) => deltas.push(delta),
      streamFetcher([
        '{"message":{"role":"assistant","content":"{\\"ans"}}\n',
        '{"message":{"role":"assistant","content":"wer\\":\\"ok\\"}"}}\n',
      ]),
    );

    expect(full).toBe('{"ans' + 'wer":"ok"}');
    expect(deltas).toEqual(['{"ans', 'wer":"ok"}']);
  });

  it('streams OpenAI-compatible SSE deltas and resolves the full text', async () => {
    const deltas: string[] = [];
    const full = await completeStream(
      'openai',
      'http://x',
      'm',
      MESSAGES,
      (delta) => deltas.push(delta),
      streamFetcher([
        'data: {"choices":[{"delta":{"content":"ol"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"á"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    expect(full).toBe('olá');
    expect(deltas).toEqual(['ol', 'á']);
  });

  it('handles a delta split across chunk boundaries', async () => {
    const deltas: string[] = [];
    const full = await completeStream(
      'ollama',
      'http://x',
      'm',
      MESSAGES,
      (delta) => deltas.push(delta),
      streamFetcher(['{"message":{"content":"ab', 'c"}}\n']),
    );

    expect(full).toBe('abc');
    expect(deltas).toEqual(['abc']);
  });

  it('throws when the server refuses', async () => {
    await expect(
      completeStream('ollama', 'http://x', 'm', MESSAGES, () => {}, streamFetcher([], false, 500)),
    ).rejects.toThrow('HTTP 500');
  });
});
