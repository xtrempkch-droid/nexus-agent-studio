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
  chatUrl,
  complete,
  type LlmFetcher,
} from './llmClient.ts';

const MESSAGES = [{ role: 'user' as const, content: 'olá' }];

function fetcherWith(payload: unknown, ok = true, status = 200): LlmFetcher {
  return async () => ({ ok, status, json: async () => payload });
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
