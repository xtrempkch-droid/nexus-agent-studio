/**
 * Reading pages and searching the web, without dependencies.
 *
 * Two shapes of the same problem: a URL from a model and a query from a model are
 * both untrusted input, so both go through {@link normalizePublicUrl} and
 * {@link assertResolvesPublic} before any socket is opened, and both bound what
 * they read so one page cannot exhaust memory.
 *
 * The network call is an injected function (`WebFetcher`), for the same reason the
 * agent's model call is: the tests must be able to assert the *request* — URL,
 * headers, redirect handling — without a network, and a flaky third-party site is
 * not a test.
 *
 * @module common/web/webClient
 */

import {
  FetchPolicyError,
  assertResolvesPublic,
  normalizePublicUrl,
  type DnsLookup,
} from './fetchPolicy.ts';

/** Largest body read from one page. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Largest amount of readable text handed back to the model. */
export const MAX_TEXT_CHARS = 20_000;

/** Per-request budget for a page. */
const FETCH_TIMEOUT_MS = 15_000;

/** Per-request budget for a search. */
const SEARCH_TIMEOUT_MS = 12_000;

/** Redirects followed before giving up. */
const MAX_REDIRECTS = 3;

/** Search results returned at most. */
const MAX_RESULTS = 8;

/** How the caller reaches the network. Injected so tests never do. */
export type WebFetcher = (request: {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}) => Promise<{
  readonly status: number;
  /** Header names lower-cased; values as received. */
  readonly headers: Readonly<Record<string, string>>;
  /** Body text, already capped by the fetcher. */
  readonly body: string;
  /** Whether the body was cut at the cap. */
  readonly truncated: boolean;
}>;

/**
 * The real fetcher: platform `fetch`, manual redirects, a timeout and a byte cap.
 *
 * Redirects are followed by hand so each hop can be re-checked by the policy — a
 * public URL that redirects to `http://127.0.0.1` must not be followed.
 */
export const defaultWebFetcher: WebFetcher = async (request) => {
  const response = await fetch(request.url, {
    redirect: 'manual',
    headers: request.headers,
    signal: AbortSignal.timeout(request.timeoutMs),
  });

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const { body, truncated } = await readBounded(response, MAX_BYTES);
  return { status: response.status, headers, body, truncated };
};

/** Read a response body, refusing to buffer more than `maxBytes`. */
async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new FetchPolicyError(`The page is too large (${String(Math.round(declared / 1024))} KB).`);
  }

  const stream = response.body;
  if (stream === null) {
    const text = await response.text();
    return {
      body: text.slice(0, maxBytes),
      truncated: text.length > maxBytes,
    };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }

  const merged = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { body: new TextDecoder('utf-8').decode(merged), truncated };
}

/** The named entities worth decoding for readable text; unknown ones are kept. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  deg: '°',
  middot: '·',
  eacute: 'é',
  atilde: 'ã',
  ccedil: 'ç',
  otilde: 'õ',
};

/** Decode numeric and the handful of named entities above. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, code: string) => {
    if (code.startsWith('#')) {
      const value =
        code[1] === 'x' || code[1] === 'X'
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x11_0000
        ? String.fromCodePoint(value)
        : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * HTML to readable text, keeping the structure a model needs.
 *
 * Scripts, styles and `head` are noise for this purpose; block elements become
 * newlines, list items become `- ` bullets and headings become `#` prefixes, so
 * the result reads like the page rather than like one long line.
 */
export function htmlToText(html: string): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(script|style|noscript|template|svg|canvas)\b[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<head\b[\s\S]*?<\/head>/gi, ' ');
  text = text.replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<li\b[^>]*>/gi, '\n- ');
  text = text.replace(/<h([1-6])\b[^>]*>/gi, (_match, level: string) => `\n${'#'.repeat(Number(level))} `);
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  text = text.replace(/[ \t\f\v\u00a0]+/g, ' ');
  text = text.replace(/ *\n */g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/** The document title, or `null` when it has none. */
export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1] === undefined
    ? null
    : decodeEntities(match[1]).replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** One page, as the model receives it. */
export interface WebPage {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly title: string | null;
  readonly text: string;
  readonly truncated: boolean;
  readonly bytes: number;
}

/** Options shared by the web operations. */
export interface WebOptions {
  /** Network call. Defaults to {@link defaultWebFetcher}. */
  readonly fetcher?: WebFetcher;
  /** DNS resolution used by the policy. Defaults to the real resolver. */
  readonly lookup?: DnsLookup;
  /** Per-request budget. Defaults to the module's constants. */
  readonly timeoutMs?: number;
}

/** HTTP statuses that mean "there is nothing to read here". */
function explainStatus(status: number): FetchPolicyError | null {
  if (status === 404) return new FetchPolicyError('The page does not exist (404).');
  if (status === 401 || status === 403) {
    return new FetchPolicyError(`The site refused access (HTTP ${String(status)}).`);
  }
  if (status === 429) return new FetchPolicyError('The site asked to slow down (HTTP 429).');
  if (status < 200 || status >= 300) {
    return new FetchPolicyError(`The site answered HTTP ${String(status)}.`);
  }
  return null;
}

/**
 * Fetch one public page and return its readable text.
 *
 * @throws {FetchPolicyError} for a URL outside the policy, a binary body, an
 *   error status, or too many redirects — always with a message meant for the
 *   model rather than a stack trace.
 */
export async function fetchPage(
  rawUrl: unknown,
  options: WebOptions & { readonly maxChars?: number } = {},
): Promise<WebPage> {
  const fetcher = options.fetcher ?? defaultWebFetcher;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxChars = options.maxChars ?? MAX_TEXT_CHARS;

  let parsed = normalizePublicUrl(rawUrl);
  let response: Awaited<ReturnType<WebFetcher>> | null = null;

  for (let hop = 0; ; hop += 1) {
    await assertResolvesPublic(parsed.hostname, options.lookup);

    try {
      response = await fetcher({
        url: parsed.toString(),
        headers: {
          'User-Agent': 'NexusAgentStudio/0.1 (+agent web fetch)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
        timeoutMs,
      });
    } catch (error) {
      if (error instanceof FetchPolicyError) throw error;
      const message = (error as Error).message;
      if (/timeout|abort/i.test(message)) {
        throw new FetchPolicyError(
          `The page did not answer within ${String(Math.round(timeoutMs / 1000))}s.`,
        );
      }
      throw new FetchPolicyError(`Could not reach the page: ${message}`);
    }

    const location = response.headers['location'];
    const redirect = response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307 || response.status === 308;
    if (!redirect || location === undefined) {
      break;
    }
    if (hop >= MAX_REDIRECTS) {
      throw new FetchPolicyError('Too many redirects.');
    }
    // Re-validated from scratch: a redirect is untrusted input too.
    parsed = normalizePublicUrl(new URL(location, parsed).toString());
  }

  const failure = explainStatus(response.status);
  if (failure !== null) throw failure;

  const contentType = (response.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
  if (/^(image|audio|video|font)\//i.test(contentType) || /octet-stream/i.test(contentType)) {
    throw new FetchPolicyError(`Binary content (${contentType}) is not supported.`);
  }

  const bytes = Buffer.byteLength(response.body, 'utf8');
  const isStructured = /^(application|text)\/(json|xml)/i.test(contentType);

  if (isStructured) {
    const text = response.body.slice(0, maxChars);
    return {
      url: parsed.toString(),
      status: response.status,
      contentType,
      title: null,
      text,
      truncated: response.truncated || response.body.length > maxChars,
      bytes,
    };
  }

  const title = extractTitle(response.body);
  const readable = htmlToText(response.body);
  const text = readable.slice(0, maxChars);

  return {
    url: parsed.toString(),
    status: response.status,
    contentType: contentType === '' ? 'text/html' : contentType,
    title,
    text,
    // Compared against the *unsliced* text: `text` is already capped, so asking
    // whether it exceeds the cap would always answer no.
    truncated: response.truncated || readable.length > maxChars,
    bytes,
  };
}

/** One search hit, as the model receives it. */
export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

/** A search, as the model receives it. */
export interface SearchOutcome {
  readonly query: string;
  /** Which backend answered: `duckduckgo` or `searxng`. */
  readonly engine: 'duckduckgo' | 'searxng';
  readonly results: readonly SearchResult[];
}

/** Decode DuckDuckGo's redirect link (`//duckduckgo.com/l/?uddg=<target>`). */
function decodeDuckUrl(href: string): string {
  const match = /[?&]uddg=([^&]+)/.exec(href);
  if (match?.[1] !== undefined) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return href;
    }
  }
  return href.startsWith('//') ? `https:${href}` : href;
}

/**
 * Parse DuckDuckGo's HTML results page.
 *
 * Written against the markup the free endpoint emits today (`result__a` links and
 * `result__snippet` text). It is scraped markup, so it can change without notice;
 * that is exactly why the caller is told which engine answered and why a SearXNG
 * endpoint can be configured instead.
 */
export function parseDuckDuckGo(html: string, limit: number): SearchResult[] {
  const snippets: string[] = [];
  const snippetPattern = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let match = snippetPattern.exec(html); match !== null; match = snippetPattern.exec(html)) {
    snippets.push(htmlToText(match[1] ?? '').slice(0, 300));
  }

  const results: SearchResult[] = [];
  const linkPattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let index = 0;
  for (let match = linkPattern.exec(html); match !== null && results.length < limit; match = linkPattern.exec(html)) {
    const url = decodeDuckUrl(match[1] ?? '');
    if (!/^https?:\/\//i.test(url)) continue;
    results.push({
      title: htmlToText(match[2] ?? '').slice(0, 200),
      url,
      snippet: snippets[index] ?? '',
    });
    index += 1;
  }

  return results;
}

/** Parse a SearXNG JSON payload. */
export function parseSearxng(payload: unknown, limit: number): SearchResult[] {
  const items =
    typeof payload === 'object' && payload !== null && Array.isArray((payload as { results?: unknown }).results)
      ? ((payload as { results: unknown[] }).results as unknown[])
      : [];

  return items.slice(0, limit).map((item) => {
    const entry = (item ?? {}) as { title?: unknown; url?: unknown; content?: unknown };
    return {
      title: String(entry.title ?? '').slice(0, 200),
      url: String(entry.url ?? ''),
      snippet: String(entry.content ?? '').slice(0, 300),
    };
  });
}

/**
 * Search the web.
 *
 * `NEXUS_SEARCH_URL` points at a SearXNG instance and takes precedence over the
 * free DuckDuckGo endpoint, which rate-limits and whose markup drifts.
 *
 * @throws {FetchPolicyError} for a query outside the accepted shape or a backend
 *   that failed — again with a message the model can act on.
 */
export async function searchWeb(
  rawQuery: unknown,
  options: WebOptions & { readonly limit?: number; readonly searxUrl?: string } = {},
): Promise<SearchOutcome> {
  const fetcher = options.fetcher ?? defaultWebFetcher;
  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';

  if (query.length < 2) {
    throw new FetchPolicyError('The query is too short.');
  }
  if (query.length > 300) {
    throw new FetchPolicyError('The query is limited to 300 characters.');
  }

  const requested = options.limit ?? 5;
  const limit = Math.min(Math.max(Number.isFinite(requested) ? Math.trunc(requested) : 5, 1), MAX_RESULTS);
  const searx = options.searxUrl ?? process.env['NEXUS_SEARCH_URL'];
  const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;

  if (searx !== undefined && searx.trim() !== '') {
    const base = searx.trim().replace(/\/$/, '');
    const target = normalizePublicUrl(`${base}/search?q=${encodeURIComponent(query)}&format=json`);
    await assertResolvesPublic(target.hostname, options.lookup);

    const response = await fetcher({ url: target.toString(), headers: {}, timeoutMs });
    if (response.status < 200 || response.status >= 300) {
      throw new FetchPolicyError(`The search backend answered HTTP ${String(response.status)}.`);
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(response.body);
    } catch {
      throw new FetchPolicyError('The search backend did not return JSON.');
    }

    return { query, engine: 'searxng', results: parseSearxng(payload, limit) };
  }

  const target = normalizePublicUrl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  await assertResolvesPublic(target.hostname, options.lookup);

  const response = await fetcher({
    url: target.toString(),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NexusAgentStudio/0.1)',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
    timeoutMs,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new FetchPolicyError(
      `The free search answered HTTP ${String(response.status)}. Use web_fetch on a known URL, ` +
        'or set NEXUS_SEARCH_URL to your own SearXNG instance.',
    );
  }

  return { query, engine: 'duckduckgo', results: parseDuckDuckGo(response.body, limit) };
}
