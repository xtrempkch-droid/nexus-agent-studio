/**
 * Project memory: facts the agent should still know next session.
 *
 * The conversation is forgotten when the app closes; a short list of durable
 * facts — "the API lives in `server/routes.ts`", "tests need `npm run test:integration`" —
 * is what stops the next session from rediscovering the project. It lives in
 * `AGENTS.md` at the workspace root because that is the file every agent tool
 * already reads, and because a plain Markdown file is something the user can edit,
 * review in a diff and commit alongside the code.
 *
 * Writes are **appends to one section**, never a rewrite: the rest of `AGENTS.md`
 * is hand-written prose, and a tool that regenerated the file would destroy it.
 *
 * @module common/mcp/tools/memoryTools
 */

import { readFile } from 'node:fs/promises';
import * as z from 'zod/v4';
import { resolveWorkspacePath, PathTraversalError, toWorkspaceRelative } from '../../security/pathGuard.ts';
import { errorResult, jsonResult, type ToolRegistration } from '../types.ts';
import { writeFileAtomically } from './atomicWrite.ts';

/** File the memory lives in, at the workspace root. */
export const MEMORY_FILE = 'AGENTS.md';

/** Heading that delimits the memory section. */
export const MEMORY_HEADING = '## Memória do projeto';

/** Longest single fact accepted. */
const MAX_FACT_CHARS = 500;

/** How many facts the section may hold before the tool refuses to add more. */
const MAX_FACTS = 200;

/** Dependencies for {@link createMemoryTools}. */
export interface MemoryToolsOptions {
  /** Absolute workspace root. */
  readonly workspaceRoot: string;
}

/** Where the memory section starts and ends inside a document. */
export interface MemorySection {
  /** Index of the heading line, or `-1` when the section is absent. */
  readonly headingIndex: number;
  /** Index one past the last line of the section. */
  readonly endIndex: number;
  /** The bullet texts, in order, without the leading `- `. */
  readonly facts: readonly string[];
}

/**
 * Locate the memory section and read its bullets.
 *
 * A bullet is a line starting with `- ` (or `* `) until the next heading of the
 * same or higher level; anything else inside the section — prose, blank lines,
 * sub-headings — is preserved and ignored.
 */
export function readMemorySection(document: string): MemorySection {
  const lines = document.split('\n');
  const headingIndex = lines.findIndex((line) => line.trim() === MEMORY_HEADING);

  if (headingIndex === -1) {
    return { headingIndex: -1, endIndex: -1, facts: [] };
  }

  let endIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^##\s/.test(line.trim()) || /^#\s/.test(line.trim())) {
      endIndex = index;
      break;
    }
  }

  const facts: string[] = [];
  for (let index = headingIndex + 1; index < endIndex; index += 1) {
    const line = lines[index] ?? '';
    const bullet = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (bullet?.[1] !== undefined) {
      facts.push(bullet[1]);
    }
  }

  return { headingIndex, endIndex, facts };
}

/** Collapse whitespace so one fact stays on one line. */
function normalizeFact(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Add `fact` to `document`, returning the new document and whether it was added.
 *
 * Pure, so the interesting rules — duplicate detection, where the bullet lands,
 * creating the section when missing — are testable without touching disk.
 */
export function appendMemoryFact(
  document: string,
  fact: string,
): { readonly document: string; readonly added: boolean; readonly reason?: string } {
  const normalized = normalizeFact(fact);

  if (normalized === '') {
    return { document, added: false, reason: 'The fact is empty.' };
  }
  if (normalized.length > MAX_FACT_CHARS) {
    return {
      document,
      added: false,
      reason: `The fact is longer than ${String(MAX_FACT_CHARS)} characters. Keep it to one line.`,
    };
  }

  const section = readMemorySection(document);

  if (section.facts.some((existing) => existing.trim() === normalized)) {
    return { document, added: false, reason: 'That fact is already in the project memory.' };
  }
  if (section.facts.length >= MAX_FACTS) {
    return {
      document,
      added: false,
      reason: `The project memory already holds ${String(MAX_FACTS)} facts. Remove some before adding more.`,
    };
  }

  const bullet = `- ${normalized}`;

  if (section.headingIndex === -1) {
    const base = document.endsWith('\n') || document === '' ? document : `${document}\n`;
    const separator = base === '' ? '' : '\n';
    return {
      document: `${base}${separator}${MEMORY_HEADING}\n\n${bullet}\n`,
      added: true,
    };
  }

  const lines = document.split('\n');
  // Insert after the last bullet so the list stays contiguous, or right after the
  // heading (plus its blank line) when the section is still empty.
  let insertAt = section.headingIndex + 1;
  for (let index = section.headingIndex + 1; index < section.endIndex; index += 1) {
    if (/^\s*[-*]\s+/.test(lines[index] ?? '')) {
      insertAt = index + 1;
    }
  }
  if (insertAt === section.headingIndex + 1) {
    // Empty section: keep one blank line between the heading and the first bullet.
    if ((lines[section.headingIndex + 1] ?? '').trim() === '') {
      insertAt = section.headingIndex + 2;
    }
  }

  lines.splice(insertAt, 0, bullet);
  return { document: lines.join('\n'), added: true };
}

/**
 * Create the project-memory tools.
 *
 * @param options - Workspace root.
 */
export function createMemoryTools(options: MemoryToolsOptions): ToolRegistration[] {
  const { workspaceRoot } = options;

  const rememberTool: ToolRegistration = {
    definition: {
      name: 'remember_project_fact',
      description:
        `Add one durable fact about this project to ${MEMORY_FILE} (the "` +
        `${MEMORY_HEADING}" section), so a future session starts knowing it. ` +
        'Use it for things that are not obvious from the code: conventions, commands, ' +
        'where a subsystem lives. One line per fact; duplicates are ignored.',
      inputSchema: z.object({
        fact: z
          .string()
          .min(3)
          .max(MAX_FACT_CHARS)
          .describe('One sentence, e.g. "Integration tests need `npm run test:integration`."'),
      }),
    },
    handler: async ({ fact }) => {
      let absolute: string;
      try {
        absolute = resolveWorkspacePath(workspaceRoot, MEMORY_FILE);
      } catch (error) {
        if (error instanceof PathTraversalError) {
          return errorResult(error.message);
        }
        throw error;
      }

      let document = '';
      try {
        document = await readFile(absolute, 'utf8');
      } catch {
        // A workspace without AGENTS.md is normal; the section is created below.
        document = '';
      }

      const result = appendMemoryFact(document, fact);
      if (!result.added) {
        return jsonResult({
          path: MEMORY_FILE,
          added: false,
          reason: result.reason ?? 'Nothing to add.',
          facts: readMemorySection(result.document).facts.length,
        });
      }

      try {
        await writeFileAtomically(absolute, result.document);
      } catch (error) {
        return errorResult(`Failed to update ${MEMORY_FILE}: ${(error as Error).message}`);
      }

      return jsonResult({
        path: toWorkspaceRelative(workspaceRoot, absolute),
        added: true,
        facts: readMemorySection(result.document).facts.length,
      });
    },
  };

  const recallTool: ToolRegistration = {
    definition: {
      name: 'recall_project_memory',
      description:
        `Read back the "` +
        `${MEMORY_HEADING}" section of ${MEMORY_FILE}: the facts recorded by previous ` +
        'sessions. The rest of the file is the project handoff document — read it with ' +
        '`read_file` when you need the full context.',
      inputSchema: z.object({}),
    },
    handler: async () => {
      let absolute: string;
      try {
        absolute = resolveWorkspacePath(workspaceRoot, MEMORY_FILE);
      } catch (error) {
        if (error instanceof PathTraversalError) {
          return errorResult(error.message);
        }
        throw error;
      }

      let document: string;
      try {
        document = await readFile(absolute, 'utf8');
      } catch {
        return jsonResult({ path: MEMORY_FILE, found: false, count: 0, facts: [] });
      }

      const section = readMemorySection(document);
      return jsonResult({
        path: MEMORY_FILE,
        found: section.headingIndex !== -1,
        count: section.facts.length,
        facts: section.facts,
      });
    },
  };

  return [rememberTool, recallTool];
}
