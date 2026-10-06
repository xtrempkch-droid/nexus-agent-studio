/**
 * Tests for the editor-context tools.
 *
 * The pair is what makes the context useful: `set_editor_context` is the UI
 * reporting what is on screen, `get_editor_context` is the agent asking. These
 * tests pin the merge rules, because a patch that silently drops a field would
 * only show up as an agent acting on stale state.
 *
 * @module common/mcp/tools/editorTools.test
 */

import { describe, expect, it } from 'vitest';
import type { ToolRegistration, ToolResult } from '../types.ts';
import { EMPTY_EDITOR_CONTEXT, EditorContextStore, createEditorTools } from './editorTools.ts';
import type { EditorContext } from './editorTools.ts';

function tools(): readonly ToolRegistration[] {
  return createEditorTools(new EditorContextStore());
}

function toolNamed(registrations: readonly ToolRegistration[], name: string): ToolRegistration {
  const found = registrations.find((tool) => tool.definition.name === name);
  if (found === undefined) {
    throw new Error(`no tool named "${name}"`);
  }
  return found;
}

/** Unwrap a JSON payload, failing loudly on an error result. */
function payload<T>(result: ToolResult): T {
  const text = result.content[0]?.text ?? '';
  if (result.isError === true) {
    throw new Error(`tool failed: ${text}`);
  }
  return JSON.parse(text) as T;
}

/** Apply a patch and read the resulting context back. */
async function report(
  registrations: readonly ToolRegistration[],
  patch: Record<string, unknown>,
): Promise<EditorContext> {
  return payload<EditorContext>(await toolNamed(registrations, 'set_editor_context').handler(patch));
}

describe('createEditorTools', () => {
  it('registers both halves of the context', () => {
    expect(tools().map((tool) => tool.definition.name)).toEqual([
      'get_editor_context',
      'set_editor_context',
    ]);
  });

  it('reports the empty context before the UI has said anything', async () => {
    const context = payload<EditorContext>(
      await toolNamed(tools(), 'get_editor_context').handler({}),
    );

    expect(context).toEqual(EMPTY_EDITOR_CONTEXT);
  });

  it('returns the context a full report installed', async () => {
    const registrations = tools();

    const reported = await report(registrations, {
      activeFile: 'src/main.py',
      selection: { start: { line: 3, column: 1 }, end: { line: 3, column: 9 } },
      cursor: { line: 3, column: 9 },
      openFiles: ['src/main.py', 'README.md'],
      languageId: 'python',
      dirty: true,
    });

    expect(reported.activeFile).toBe('src/main.py');
    expect(reported.cursor).toEqual({ line: 3, column: 9 });
    expect(reported.openFiles).toEqual(['src/main.py', 'README.md']);
    expect(reported.dirty).toBe(true);

    const read = payload<EditorContext>(await toolNamed(registrations, 'get_editor_context').handler({}));
    expect(read).toEqual(reported);
  });

  it('keeps the fields a partial report leaves out', async () => {
    const registrations = tools();

    await report(registrations, { activeFile: 'src/main.py', openFiles: ['src/main.py'] });
    const afterCursor = await report(registrations, { cursor: { line: 42, column: 7 } });

    expect(afterCursor).toMatchObject({
      activeFile: 'src/main.py',
      openFiles: ['src/main.py'],
      cursor: { line: 42, column: 7 },
      selection: null,
    });
  });

  it('treats an explicit null as a value, not as a missing field', async () => {
    const registrations = tools();

    await report(registrations, {
      activeFile: 'src/main.py',
      selection: { start: { line: 1, column: 1 }, end: { line: 2, column: 1 } },
    });
    const cleared = await report(registrations, { selection: null });

    expect(cleared.selection).toBeNull();
    expect(cleared.activeFile).toBe('src/main.py');
  });

  it('derives the language id from the file when the report omits it', async () => {
    const registrations = tools();

    expect((await report(registrations, { activeFile: 'src/App.tsx' })).languageId).toBe(
      'typescriptreact',
    );
    expect((await report(registrations, { activeFile: 'notes.txt' })).languageId).toBe('plaintext');
  });

  it('lets an explicit language id win over the derivation', async () => {
    const registrations = tools();

    const reported = await report(registrations, {
      activeFile: 'src/App.tsx',
      languageId: 'vue',
    });

    expect(reported.languageId).toBe('vue');
  });

  it('clears the language id when the active file is cleared', async () => {
    const registrations = tools();

    await report(registrations, { activeFile: 'src/main.py' });
    const closed = await report(registrations, { activeFile: null });

    expect(closed.activeFile).toBeNull();
    expect(closed.languageId).toBeNull();
  });

  it('copies the open-file list instead of aliasing the array it was given', async () => {
    const registrations = tools();
    const openFiles = ['src/main.py'];

    const reported = await report(registrations, { openFiles });

    expect(reported.openFiles).toEqual(openFiles);
    expect(reported.openFiles).not.toBe(openFiles);
  });

  it('freezes what it stores, so a later mutation cannot rewrite history', () => {
    const store = new EditorContextStore();
    store.set({ ...EMPTY_EDITOR_CONTEXT, activeFile: 'a.ts' });

    expect(Object.isFrozen(store.get())).toBe(true);
  });
});
