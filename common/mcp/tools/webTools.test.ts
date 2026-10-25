/**
 * Tests for the web tools.
 *
 * The behaviour worth pinning is the gate, not the network: disabled tools must
 * still *answer* with the reason and the exact switch, and enabled ones must pass
 * the caller's arguments through to the client.
 *
 * @module common/mcp/tools/webTools.test
 */

import { describe, expect, it } from 'vitest';
import type { DnsLookup } from '../../web/fetchPolicy.ts';
import type { WebFetcher } from '../../web/webClient.ts';
import type { ToolRegistration, ToolResult } from '../types.ts';
import { WEB_ACCESS_ENV, createWebTools, webAccessFromEnvironment } from './webTools.ts';

const PUBLIC_DNS: DnsLookup = () => Promise.resolve([{ address: '93.184.216.34' }]);

const PAGE: WebFetcher = () =>
  Promise.resolve({
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: '<title>Doc</title><p>conteúdo útil</p>',
    truncated: false,
  });

function toolNamed(tools: readonly ToolRegistration[], name: string): ToolRegistration {
  const found = tools.find((tool) => tool.definition.name === name);
  if (found === undefined) {
    throw new Error(`no tool named "${name}"`);
  }
  return found;
}

function payload<T>(result: ToolResult): T {
  const first = result.content[0];
  if (first === undefined) {
    throw new Error('the tool returned no content');
  }
  if (result.isError === true) {
    throw new Error(`the tool failed: ${first.text}`);
  }
  return JSON.parse(first.text) as T;
}

describe('webAccessFromEnvironment', () => {
  const original = process.env[WEB_ACCESS_ENV];

  const set = (value: string | undefined): void => {
    if (value === undefined) {
      delete process.env[WEB_ACCESS_ENV];
    } else {
      process.env[WEB_ACCESS_ENV] = value;
    }
  };

  it('is off unless asked', () => {
    // The default matters more than the switch: these are the only tools that
    // send data off the machine.
    set(undefined);
    expect(webAccessFromEnvironment()).toBe(false);
    set('0');
    expect(webAccessFromEnvironment()).toBe(false);
    set('yes');
    expect(webAccessFromEnvironment()).toBe(false);
  });

  it('accepts the two spellings that mean yes', () => {
    set('1');
    expect(webAccessFromEnvironment()).toBe(true);
    set('true');
    expect(webAccessFromEnvironment()).toBe(true);
  });

  it('restores the previous value', () => {
    set(original);
  });
});

describe('createWebTools when disabled', () => {
  it('answers with the reason and the exact switch instead of failing silently', async () => {
    const tools = createWebTools({ enabled: false, fetcher: PAGE, lookup: PUBLIC_DNS });

    for (const name of ['web_fetch', 'web_search']) {
      const result = await toolNamed(tools, name).handler({ url: 'https://x.example', query: 'x' });
      expect(result.isError, name).toBe(true);
      expect(result.content[0]?.text, name).toContain(WEB_ACCESS_ENV);
    }
  });

  it('never calls the network', async () => {
    let called = 0;
    const fetcher: WebFetcher = () => {
      called += 1;
      return PAGE({ url: '', headers: {}, timeoutMs: 0 });
    };

    await toolNamed(createWebTools({ enabled: false, fetcher, lookup: PUBLIC_DNS }), 'web_fetch').handler({
      url: 'https://x.example',
    });

    expect(called).toBe(0);
  });
});

describe('createWebTools when enabled', () => {
  it('returns the page it fetched', async () => {
    const tools = createWebTools({ enabled: true, fetcher: PAGE, lookup: PUBLIC_DNS });

    const page = payload<{ url: string; title: string; text: string }>(
      await toolNamed(tools, 'web_fetch').handler({ url: 'https://docs.example/guia' }),
    );

    expect(page.url).toBe('https://docs.example/guia');
    expect(page.title).toBe('Doc');
    expect(page.text).toContain('conteúdo útil');
  });

  it('turns a policy refusal into the tool message, not a thrown error', async () => {
    const tools = createWebTools({ enabled: true, fetcher: PAGE, lookup: PUBLIC_DNS });

    const result = await toolNamed(tools, 'web_fetch').handler({ url: 'http://localhost:3000/' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('local network');
  });

  it('reports a search backend failure the same way', async () => {
    const failing: WebFetcher = () => Promise.resolve({ status: 429, headers: {}, body: '', truncated: false });
    const tools = createWebTools({ enabled: true, fetcher: failing, lookup: PUBLIC_DNS });

    const result = await toolNamed(tools, 'web_search').handler({ query: 'algo' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('HTTP 429');
  });
});
