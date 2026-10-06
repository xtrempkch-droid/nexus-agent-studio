/**
 * Tests for the built-in file-system tools.
 *
 * These run against a real temporary directory rather than a mocked `fs`: the
 * behaviour under test is what the filesystem does — atomic replace, directory
 * walking, containment — and a mock would only assert that the code calls the
 * functions it obviously calls.
 *
 * @module common/mcp/tools/fileTools.test
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExecutionLogger } from '../../debug/logger.ts';
import type { ToolRegistration, ToolResult } from '../types.ts';
import { createFileTools } from './fileTools.ts';

/** The shape `list_directory` answers with. */
interface Listing {
  readonly root: string;
  readonly count: number;
  readonly truncated: boolean;
  readonly entries: readonly {
    readonly path: string;
    readonly type: 'file' | 'directory';
    readonly size: number;
  }[];
}

/** The shape `read_file` answers with. */
interface Contents {
  readonly path: string;
  readonly bytes: number;
  readonly content: string;
}

let root: string;
let tools: readonly ToolRegistration[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nexus-file-tools-'));
  tools = createFileTools({ workspaceRoot: root, logger: new ExecutionLogger(root) });
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

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return await toolNamed(name).handler(args);
}

/** Unwrap a JSON tool result, failing loudly when the tool reported an error. */
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

function pathsOf(listing: Listing): readonly string[] {
  return listing.entries.map((entry) => entry.path);
}

describe('list_directory', () => {
  it('walks the tree and reports workspace-relative paths', async () => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'main.ts'), 'export {};\n', 'utf8');

    const listing = payload<Listing>(await call('list_directory', { path: '.' }));

    expect(listing.root).toBe('.');
    expect(listing.truncated).toBe(false);
    expect(pathsOf(listing)).toContain('src');
    expect(pathsOf(listing)).toContain('src/main.ts');
  });

  it('orders entries by path, keeping a directory next to its children', async () => {
    // The failure this guards against is invisible in a tiny fixture and
    // obvious in a real project: `readdir` order is whatever the filesystem
    // keeps, so without sorting a hundred files arrive in no order a reader can
    // follow, and the explorer looks broken while being perfectly correct.
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'README.md'), 'r', 'utf8');
    await writeFile(join(root, 'src', 'main.ts'), 'm', 'utf8');

    const listing = payload<Listing>(await call('list_directory', { path: '.' }));

    // Uppercase sorts first by code unit, and `src` is a prefix of
    // `src/main.ts`, so the parent lands immediately above its child.
    expect(pathsOf(listing)).toEqual(['README.md', 'docs', 'src', 'src/main.ts']);
  });

  it('never descends into version control or dependency trees', async () => {
    // The failure this guards against is not hypothetical: a repository's
    // `.git/objects` holds more files than its source, so an unfiltered walk
    // exhausts the entry budget before reaching any code and the explorer opens
    // full of object hashes.
    await mkdir(join(root, '.git', 'objects', 'ab'), { recursive: true });
    await writeFile(join(root, '.git', 'objects', 'ab', 'cdef0123'), 'x', 'utf8');
    await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), 'x', 'utf8');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'main.ts'), 'export {};\n', 'utf8');

    const listing = payload<Listing>(await call('list_directory', { path: '.' }));

    expect(pathsOf(listing)).toContain('src/main.ts');
    expect(pathsOf(listing).some((path) => path.startsWith('.git'))).toBe(false);
    expect(pathsOf(listing).some((path) => path.startsWith('node_modules'))).toBe(false);
    // Not even the directory itself is listed: showing it empty would claim
    // something false about its contents.
    expect(pathsOf(listing)).not.toContain('.git');
    expect(pathsOf(listing)).not.toContain('node_modules');
  });

  it('still lists an excluded directory when it is named explicitly', async () => {
    // The exclusion filters the entries of a walk, not the starting point.
    // Asking for the path is a different request and is honoured.
    await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), 'x', 'utf8');

    const listing = payload<Listing>(await call('list_directory', { path: 'node_modules' }));

    expect(listing.root).toBe('node_modules');
    expect(pathsOf(listing)).toContain('node_modules/left-pad/index.js');
  });

  it('honours an override of the excluded names', async () => {
    await mkdir(join(root, 'custom-noise'), { recursive: true });
    await mkdir(join(root, '.git'), { recursive: true });

    const overridden = createFileTools({
      workspaceRoot: root,
      logger: new ExecutionLogger(root),
      excludedDirectories: ['custom-noise'],
    });
    const listingTool = overridden.find((tool) => tool.definition.name === 'list_directory');
    const result = await listingTool?.handler({ path: '.' });

    const listing = payload<Listing>(result as ToolResult);
    expect(pathsOf(listing)).not.toContain('custom-noise');
    expect(pathsOf(listing)).toContain('.git');
  });
});

describe('write_file and read_file', () => {
  it('round-trips content unchanged, newlines included', async () => {
    const written = payload<{ created: boolean; bytesWritten: number }>(
      await call('write_file', { path: 'notes.txt', content: 'linha 1\nlinha 2\n' }),
    );

    expect(written.created).toBe(true);

    const read = payload<Contents>(await call('read_file', { path: 'notes.txt' }));
    expect(read.content).toBe('linha 1\nlinha 2\n');
  });

  it('creates missing parent directories', async () => {
    await call('write_file', { path: 'deep/nested/file.txt', content: 'ok' });

    const read = payload<Contents>(await call('read_file', { path: 'deep/nested/file.txt' }));
    expect(read.content).toBe('ok');
  });

  it('reports an existing file as replaced rather than created', async () => {
    await call('write_file', { path: 'a.txt', content: 'first' });

    const written = payload<{ created: boolean }>(
      await call('write_file', { path: 'a.txt', content: 'second' }),
    );

    expect(written.created).toBe(false);
  });

  it('refuses to read outside the workspace', async () => {
    const result = await call('read_file', { path: '../escaped.txt' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('escapes the workspace');
  });

  it('refuses to write outside the workspace', async () => {
    const result = await call('write_file', { path: '../escaped.txt', content: 'nope' });

    expect(result.isError).toBe(true);
  });
});
