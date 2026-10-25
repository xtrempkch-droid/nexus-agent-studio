/**
 * Tests for the project-memory tools.
 *
 * Two things are worth pinning: the pure section logic (where a bullet lands, what
 * counts as a duplicate) and that a write never disturbs the hand-written prose
 * around the section — `AGENTS.md` is a document a person maintains, not a
 * database this tool owns.
 *
 * @module common/mcp/tools/memoryTools.test
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolRegistration, ToolResult } from '../types.ts';
import {
  MEMORY_FILE,
  MEMORY_HEADING,
  appendMemoryFact,
  createMemoryTools,
  readMemorySection,
} from './memoryTools.ts';

let root: string;
let tools: readonly ToolRegistration[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nexus-memory-'));
  tools = createMemoryTools({ workspaceRoot: root });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function toolNamed(name: string): ToolRegistration {
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

const DOC = `# Projeto

Texto da pessoa.

${MEMORY_HEADING}

- já sei isto

## Outra seção

Não é memória.
`;

describe('readMemorySection', () => {
  it('reads only the bullets of the memory section', () => {
    const section = readMemorySection(DOC);

    expect(section.facts).toEqual(['já sei isto']);
    expect(section.headingIndex).toBe(4);
  });

  it('reports a missing section without inventing one', () => {
    expect(readMemorySection('# Projeto\n')).toEqual({
      headingIndex: -1,
      endIndex: -1,
      facts: [],
    });
  });

  it('stops at the next heading of the same level', () => {
    const document = `${MEMORY_HEADING}\n\n- a\n\n## Depois\n\n- não é memória\n`;
    expect(readMemorySection(document).facts).toEqual(['a']);
  });

  it('accepts * bullets as well as - bullets', () => {
    expect(readMemorySection(`${MEMORY_HEADING}\n\n* estrela\n`).facts).toEqual(['estrela']);
  });
});

describe('appendMemoryFact', () => {
  it('adds the bullet to an existing section', () => {
    const result = appendMemoryFact(DOC, 'nova informação');

    expect(result.added).toBe(true);
    expect(result.document).toContain('- já sei isto\n- nova informação');
  });

  it('leaves the rest of the document byte-for-byte intact', () => {
    const result = appendMemoryFact(DOC, 'nova');
    const before = DOC.split('\n');
    const after = result.document.split('\n');

    // Everything except the single inserted line is unchanged, in order.
    expect(after.filter((line) => !line.includes('nova'))).toEqual(before);
  });

  it('creates the section at the end when it is missing', () => {
    const result = appendMemoryFact('# Projeto\n\nTexto.\n', 'primeira');

    expect(result.added).toBe(true);
    expect(result.document).toContain(`${MEMORY_HEADING}\n\n- primeira`);
    expect(result.document.indexOf('# Projeto')).toBe(0);
  });

  it('creates the document from nothing', () => {
    const result = appendMemoryFact('', 'primeira');

    expect(result.document.trim()).toBe(`${MEMORY_HEADING}\n\n- primeira`);
  });

  it('ignores an exact duplicate', () => {
    const result = appendMemoryFact(DOC, '  já   sei isto  ');

    expect(result.added).toBe(false);
    expect(result.reason).toContain('already');
    expect(result.document).toBe(DOC);
  });

  it('collapses whitespace so one fact stays on one line', () => {
    const result = appendMemoryFact(DOC, 'linha\n  com   espaços');

    expect(result.document).toContain('- linha com espaços');
  });

  it('refuses an empty or oversized fact', () => {
    expect(appendMemoryFact(DOC, '   ').added).toBe(false);
    expect(appendMemoryFact(DOC, 'x'.repeat(501)).added).toBe(false);
  });

  it('refuses to grow without bound', () => {
    const full = `${MEMORY_HEADING}\n\n${Array.from({ length: 200 }, (_, index) => `- f${String(index)}`).join('\n')}\n`;

    const result = appendMemoryFact(full, 'mais uma');

    expect(result.added).toBe(false);
    expect(result.reason).toContain('200 facts');
  });
});

describe('remember_project_fact / recall_project_memory', () => {
  it('round-trips a fact through disk', async () => {
    payload(await toolNamed('remember_project_fact').handler({ fact: 'os testes usam vitest' }));

    const recalled = payload<{ found: boolean; count: number; facts: string[] }>(
      await toolNamed('recall_project_memory').handler({}),
    );

    expect(recalled.found).toBe(true);
    expect(recalled.count).toBe(1);
    expect(recalled.facts).toEqual(['os testes usam vitest']);
  });

  it('writes into AGENTS.md and keeps what was already there', async () => {
    await writeFile(join(root, MEMORY_FILE), '# Handoff\n\nConteúdo da pessoa.\n', 'utf8');

    await toolNamed('remember_project_fact').handler({ fact: 'fato novo' });

    const document = await readFile(join(root, MEMORY_FILE), 'utf8');
    expect(document).toContain('Conteúdo da pessoa.');
    expect(document).toContain(`- fato novo`);
  });

  it('reports a duplicate without touching the file', async () => {
    await toolNamed('remember_project_fact').handler({ fact: 'igual' });
    const first = await readFile(join(root, MEMORY_FILE), 'utf8');

    const again = payload<{ added: boolean; reason: string }>(
      await toolNamed('remember_project_fact').handler({ fact: 'igual' }),
    );

    expect(again.added).toBe(false);
    expect(again.reason).toContain('already');
    expect(await readFile(join(root, MEMORY_FILE), 'utf8')).toBe(first);
  });

  it('answers honestly when there is no AGENTS.md yet', async () => {
    const recalled = payload<{ found: boolean; count: number }>(
      await toolNamed('recall_project_memory').handler({}),
    );

    expect(recalled).toEqual({ path: MEMORY_FILE, found: false, count: 0, facts: [] });
  });
});
