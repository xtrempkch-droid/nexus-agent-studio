/**
 * Tests for the web access policy and client.
 *
 * Both are exercised with an injected fetcher and an injected DNS lookup, so no
 * test touches the network: what matters is the *decision* — which URL is
 * refused, which redirect is re-checked, how much text comes back — not whether
 * some third-party site is up today.
 *
 * @module common/web/webClient.test
 */

import { describe, expect, it } from 'vitest';
import {
  FetchPolicyError,
  assertHostnameAllowed,
  assertResolvesPublic,
  isPrivateAddress,
  normalizePublicUrl,
  type DnsLookup,
} from './fetchPolicy.ts';
import {
  decodeEntities,
  fetchPage,
  htmlToText,
  parseDuckDuckGo,
  parseSearxng,
  searchWeb,
  type WebFetcher,
} from './webClient.ts';

const PUBLIC_DNS: DnsLookup = () => Promise.resolve([{ address: '93.184.216.34' }]);

/** A fetcher that answers from a table and records every request it saw. */
function scriptedFetcher(
  answer: (url: string) => { status: number; headers?: Record<string, string>; body?: string; truncated?: boolean },
): { fetcher: WebFetcher; requests: { url: string; headers: Record<string, string> }[] } {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  return {
    requests,
    fetcher: (request) => {
      requests.push({ url: request.url, headers: { ...request.headers } });
      const result = answer(request.url);
      return Promise.resolve({
        status: result.status,
        headers: result.headers ?? {},
        body: result.body ?? '',
        truncated: result.truncated ?? false,
      });
    },
  };
}

const HTML_PAGE = `<!doctype html>
<html><head><title>Guia &amp; Referência</title>
<style>body{color:red}</style><script>console.log('nope')</script></head>
<body><h1>Instalação</h1><p>Use <code>npm i</code> &lt;agora&gt;.</p>
<ul><li>Primeiro</li><li>Segundo</li></ul>
<!-- comentário --></body></html>`;

describe('isPrivateAddress', () => {
  it('refuses every private and reserved IPv4 range', () => {
    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '100.64.0.1',
      '192.0.2.1',
      '198.18.0.1',
      '224.0.0.1',
      'not-an-ip',
      '999.1.1.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('allows public IPv4 addresses', () => {
    for (const address of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '192.169.0.1']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('refuses private IPv6 and allows public IPv6', () => {
    for (const address of [
      '::',
      '::1',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      'ff02::1',
      '::ffff:192.168.1.1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }

    for (const address of ['2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

describe('assertHostnameAllowed', () => {
  it('refuses names that mean "this machine" or a metadata service', () => {
    for (const host of [
      'localhost',
      'LOCALHOST',
      'localhost.',
      'metadata',
      'metadata.google.internal',
      'instance-data',
      'app.localhost',
      'printer.local',
      'service.internal',
      'router.home.arpa',
      'nas.lan',
      '127.0.0.1',
      '[::1]'.replace(/[[\]]/g, ''),
    ]) {
      expect(() => assertHostnameAllowed(host), host).toThrow(FetchPolicyError);
    }
  });

  it('allows ordinary public names', () => {
    for (const host of ['example.com', 'docs.python.org', 'sub.domain.example.co.uk']) {
      expect(() => assertHostnameAllowed(host), host).not.toThrow();
    }
  });
});

describe('normalizePublicUrl', () => {
  it('accepts a bare hostname and gives it https', () => {
    expect(normalizePublicUrl('example.com/docs').toString()).toBe('https://example.com/docs');
  });

  it('drops the fragment, which is never sent to the server anyway', () => {
    expect(normalizePublicUrl('https://example.com/a#section').toString()).toBe(
      'https://example.com/a',
    );
  });

  it('refuses credentials, other protocols, local hosts and nonsense', () => {
    for (const raw of [
      'https://user:pass@example.com/',
      'ftp://example.com/file',
      'file:///etc/passwd',
      'http://localhost:3000/',
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'javascript:alert(1)',
      '',
      '   ',
      'not a url',
    ]) {
      expect(() => normalizePublicUrl(raw), raw).toThrow(FetchPolicyError);
    }
  });

  it('refuses an oversized URL', () => {
    expect(() => normalizePublicUrl(`https://example.com/${'a'.repeat(2100)}`)).toThrow(
      FetchPolicyError,
    );
  });
});

describe('assertResolvesPublic', () => {
  it('refuses a public name that resolves to a private address', async () => {
    // The whole point of resolving: the name looks fine and the address is not.
    const lookup: DnsLookup = () => Promise.resolve([{ address: '127.0.0.1' }]);

    await expect(assertResolvesPublic('evil.example', lookup)).rejects.toBeInstanceOf(
      FetchPolicyError,
    );
  });

  it('refuses when any of several addresses is private', async () => {
    const lookup: DnsLookup = () =>
      Promise.resolve([{ address: '93.184.216.34' }, { address: '10.0.0.5' }]);

    await expect(assertResolvesPublic('mixed.example', lookup)).rejects.toBeInstanceOf(
      FetchPolicyError,
    );
  });

  it('reports a name that does not resolve instead of throwing a raw error', async () => {
    const lookup: DnsLookup = () => Promise.reject(new Error('ENOTFOUND'));

    await expect(assertResolvesPublic('missing.example', lookup)).rejects.toThrow(
      /Could not resolve missing\.example/,
    );
  });
});

describe('htmlToText / decodeEntities', () => {
  it('keeps structure and drops noise', () => {
    const text = htmlToText(HTML_PAGE);

    expect(text).toContain('# Instalação');
    expect(text).toContain('- Primeiro');
    expect(text).toContain('- Segundo');
    expect(text).toContain('npm i');
    expect(text).toContain('<agora>');
    expect(text).not.toContain('console.log');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('comentário');
  });

  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#65; &#x42; &unknown;')).toBe(
      'a & b <c> A B &unknown;',
    );
  });
});

describe('fetchPage', () => {
  it('returns title and readable text for HTML', async () => {
    const { fetcher } = scriptedFetcher(() => ({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: HTML_PAGE,
    }));

    const page = await fetchPage('example.com/guia', { fetcher, lookup: PUBLIC_DNS });

    expect(page.url).toBe('https://example.com/guia');
    expect(page.status).toBe(200);
    expect(page.contentType).toBe('text/html');
    expect(page.title).toBe('Guia & Referência');
    expect(page.text).toContain('# Instalação');
    expect(page.truncated).toBe(false);
  });

  it('returns JSON as-is instead of stripping it as markup', async () => {
    const { fetcher } = scriptedFetcher(() => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"a":1,"b":[2,3]}',
    }));

    const page = await fetchPage('https://api.example.com/x', { fetcher, lookup: PUBLIC_DNS });

    expect(page.contentType).toBe('application/json');
    expect(page.title).toBeNull();
    expect(page.text).toBe('{"a":1,"b":[2,3]}');
  });

  it('re-checks every redirect hop against the policy', async () => {
    // A public URL that redirects inward must be refused, not followed.
    const { fetcher, requests } = scriptedFetcher((url) =>
      url.startsWith('https://example.com')
        ? { status: 302, headers: { location: 'http://127.0.0.1/admin' } }
        : { status: 200, body: 'segredo' },
    );

    await expect(fetchPage('https://example.com/', { fetcher, lookup: PUBLIC_DNS })).rejects.toThrow(
      /local network/i,
    );
    expect(requests).toHaveLength(1);
  });

  it('stops after too many redirects', async () => {
    const { fetcher } = scriptedFetcher((url) => ({
      status: 301,
      headers: { location: `${url}/again` },
    }));

    await expect(fetchPage('https://example.com/', { fetcher, lookup: PUBLIC_DNS })).rejects.toThrow(
      /Too many redirects/,
    );
  });

  it('explains an error status instead of returning an empty page', async () => {
    const { fetcher } = scriptedFetcher(() => ({ status: 404 }));

    await expect(fetchPage('https://example.com/x', { fetcher, lookup: PUBLIC_DNS })).rejects.toThrow(
      /does not exist \(404\)/,
    );
  });

  it('refuses binary content', async () => {
    const { fetcher } = scriptedFetcher(() => ({
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: 'PNG',
    }));

    await expect(fetchPage('https://example.com/a.png', { fetcher, lookup: PUBLIC_DNS })).rejects.toThrow(
      /Binary content/,
    );
  });

  it('caps the text it hands back and says so', async () => {
    const long = '<p>' + 'palavra '.repeat(500) + '</p>';
    const { fetcher } = scriptedFetcher(() => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: long,
    }));

    const page = await fetchPage('https://example.com/long', {
      fetcher,
      lookup: PUBLIC_DNS,
      maxChars: 100,
    });

    expect(page.text.length).toBe(100);
    expect(page.truncated).toBe(true);
  });

  it('reports a timeout as a sentence the model can act on', async () => {
    const fetcher: WebFetcher = () => Promise.reject(new Error('The operation was aborted'));

    await expect(
      fetchPage('https://example.com/slow', { fetcher, lookup: PUBLIC_DNS, timeoutMs: 3000 }),
    ).rejects.toThrow(/did not answer within 3s/);
  });

  it('never calls the network for a refused URL', async () => {
    const { fetcher, requests } = scriptedFetcher(() => ({ status: 200, body: 'x' }));

    await expect(fetchPage('http://localhost:3000/', { fetcher, lookup: PUBLIC_DNS })).rejects.toThrow(
      FetchPolicyError,
    );
    expect(requests).toHaveLength(0);
  });
});

describe('searchWeb', () => {
  it('parses the DuckDuckGo surface by default', async () => {
    const page = `
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Primeiro</a>
      <a class="result__snippet">Trecho <b>um</b></a>
      <a class="result__a" href="https://example.org/b">Segundo</a>
      <a class="result__snippet">Trecho dois</a>`;
    const { fetcher, requests } = scriptedFetcher(() => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: page,
    }));

    const outcome = await searchWeb('teste de busca', { fetcher, lookup: PUBLIC_DNS, limit: 2 });

    expect(requests[0]?.url).toContain('html.duckduckgo.com');
    expect(requests[0]?.url).toContain('q=teste%20de%20busca');
    expect(outcome.engine).toBe('duckduckgo');
    expect(outcome.results).toEqual([
      { title: 'Primeiro', url: 'https://example.com/a', snippet: 'Trecho um' },
      { title: 'Segundo', url: 'https://example.org/b', snippet: 'Trecho dois' },
    ]);
  });

  it('prefers a configured SearXNG instance', async () => {
    const { fetcher, requests } = scriptedFetcher(() => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ results: [{ title: 'A', url: 'https://a.example', content: 'trecho' }] }),
    }));

    const outcome = await searchWeb('algo', {
      fetcher,
      lookup: PUBLIC_DNS,
      searxUrl: 'https://searx.example/',
    });

    expect(requests[0]?.url).toBe('https://searx.example/search?q=algo&format=json');
    expect(outcome.engine).toBe('searxng');
    expect(outcome.results[0]).toEqual({ title: 'A', url: 'https://a.example', snippet: 'trecho' });
  });

  it('explains a rate-limited free search and points at the alternative', async () => {
    const { fetcher } = scriptedFetcher(() => ({ status: 429 }));

    await expect(searchWeb('algo', { fetcher, lookup: PUBLIC_DNS })).rejects.toThrow(
      /NEXUS_SEARCH_URL/,
    );
  });

  it('refuses a query outside the accepted shape', async () => {
    const { fetcher } = scriptedFetcher(() => ({ status: 200, body: '' }));

    await expect(searchWeb('a', { fetcher, lookup: PUBLIC_DNS })).rejects.toThrow(/too short/);
    await expect(searchWeb('x'.repeat(301), { fetcher, lookup: PUBLIC_DNS })).rejects.toThrow(
      /300 characters/,
    );
  });
});

describe('parse helpers', () => {
  it('ignores DuckDuckGo links that are not http(s)', () => {
    const html = '<a class="result__a" href="/settings">Config</a>';
    expect(parseDuckDuckGo(html, 5)).toEqual([]);
  });

  it('tolerates a SearXNG payload without results', () => {
    expect(parseSearxng({}, 5)).toEqual([]);
    expect(parseSearxng(null, 5)).toEqual([]);
  });
});
