/**
 * Web access tools: `web_fetch` and `web_search`.
 *
 * These give the agent something it cannot get from the workspace: current
 * documentation. They are also the only tools that make the core **talk to the
 * internet**, which is why they are opt-in (`NEXUS_WEB_ACCESS=1`) on the same
 * reasoning as `NEXUS_UNSANDBOXED`: a capability that changes the threat model has
 * to be asked for, and never decided by the webview.
 *
 * Disabled, the tools still answer — with the reason and the exact way to enable
 * them. A tool that vanishes from `tools/list` teaches the model nothing; a tool
 * that explains itself is one the user can act on.
 *
 * @module common/mcp/tools/webTools
 */

import * as z from 'zod/v4';
import {
  FetchPolicyError,
  type DnsLookup,
} from '../../web/fetchPolicy.ts';
import {
  MAX_TEXT_CHARS,
  fetchPage,
  searchWeb,
  type WebFetcher,
} from '../../web/webClient.ts';
import { errorResult, jsonResult, type ToolRegistration } from '../types.ts';

/** Environment switch that enables outbound web access. */
export const WEB_ACCESS_ENV = 'NEXUS_WEB_ACCESS';

/** How a caller turns the tools on, quoted verbatim in the disabled message. */
const ENABLE_HINT =
  `Web access is disabled. Set ${WEB_ACCESS_ENV}=1 in the environment that starts the core ` +
  'and restart it. It is off by default because these are the only tools that send data ' +
  'off this machine.';

/** Dependencies for {@link createWebTools}. */
export interface WebToolsOptions {
  /** Whether the tools may reach the network. Off unless asked. */
  readonly enabled: boolean;
  /** Network call. Injected by tests; the real one is used otherwise. */
  readonly fetcher?: WebFetcher;
  /** DNS resolution for the policy. Injected by tests. */
  readonly lookup?: DnsLookup;
  /** SearXNG base URL; falls back to `NEXUS_SEARCH_URL`. */
  readonly searxUrl?: string;
}

/** Whether `NEXUS_WEB_ACCESS` asks for web access. */
export function webAccessFromEnvironment(): boolean {
  const value = process.env[WEB_ACCESS_ENV];
  return value === '1' || value === 'true';
}

/** Turn a policy failure into the tool result the model reads. */
function failure(error: unknown): ReturnType<typeof errorResult> {
  if (error instanceof FetchPolicyError) {
    return errorResult(error.message);
  }
  return errorResult(`Web request failed: ${(error as Error).message}`);
}

/**
 * Create the web tools.
 *
 * @param options - Access switch plus the injectable collaborators.
 */
export function createWebTools(options: WebToolsOptions): ToolRegistration[] {
  const { fetcher, lookup, searxUrl } = options;

  const fetchTool: ToolRegistration = {
    definition: {
      name: 'web_fetch',
      description:
        'Open a public web page and return its readable text. Only http/https on the ' +
        'public internet: local addresses, private ranges and file:// are refused. ' +
        'Binary content (images, PDFs) is not supported.',
      inputSchema: z.object({
        url: z.string().min(1).describe('Public URL, e.g. https://nodejs.org/api/fs.html'),
        maxChars: z
          .number()
          .int()
          .min(500)
          .max(MAX_TEXT_CHARS)
          .optional()
          .describe(`How much text to return. Defaults to ${String(MAX_TEXT_CHARS)} characters.`),
      }),
    },
    handler: async ({ url, maxChars }) => {
      if (!options.enabled) {
        return errorResult(ENABLE_HINT);
      }
      try {
        const page = await fetchPage(url, {
          ...(fetcher === undefined ? {} : { fetcher }),
          ...(lookup === undefined ? {} : { lookup }),
          ...(maxChars === undefined ? {} : { maxChars }),
        });
        return jsonResult(page);
      } catch (error) {
        return failure(error);
      }
    },
  };

  const searchTool: ToolRegistration = {
    definition: {
      name: 'web_search',
      description:
        'Search the web and return titles, links and snippets. Use it to find the right ' +
        'page, then `web_fetch` that page for the details.',
      inputSchema: z.object({
        query: z.string().min(2).max(300).describe('What to look for.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe('How many results to return. Defaults to 5.'),
      }),
    },
    handler: async ({ query, limit }) => {
      if (!options.enabled) {
        return errorResult(ENABLE_HINT);
      }
      try {
        const outcome = await searchWeb(query, {
          ...(fetcher === undefined ? {} : { fetcher }),
          ...(lookup === undefined ? {} : { lookup }),
          ...(searxUrl === undefined ? {} : { searxUrl }),
          ...(limit === undefined ? {} : { limit }),
        });
        return jsonResult(outcome);
      } catch (error) {
        return failure(error);
      }
    },
  };

  return [fetchTool, searchTool];
}
