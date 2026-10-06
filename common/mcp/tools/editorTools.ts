/**
 * Built-in editor-context tool.
 *
 * The editor UI pushes its live state (active file, selection, cursor position,
 * open tabs) into an {@link EditorContextStore}. The `get_editor_context` tool
 * reads that store, which is how an agent knows what the user is looking at
 * without polling the UI.
 *
 * @module common/mcp/tools/editorTools
 */

import * as z from 'zod/v4';
import {
  jsonResult,
  type AnyToolHandler,
  type ToolDefinition,
  type ToolRegistration,
} from '../types.ts';

/** A 1-based cursor position. */
export interface CursorPosition {
  readonly line: number;
  readonly column: number;
}

/** A 1-based text selection. */
export interface TextSelection {
  readonly start: CursorPosition;
  readonly end: CursorPosition;
}

/**
 * Real-time editor state exposed to the agent.
 */
export interface EditorContext {
  /** Workspace-relative path of the focused file, or `null`. */
  readonly activeFile: string | null;
  /** Current selection, or `null` when the cursor is collapsed. */
  readonly selection: TextSelection | null;
  /** Caret position in the active file. */
  readonly cursor: CursorPosition;
  /** Open tabs, in order. */
  readonly openFiles: readonly string[];
  /** Language id reported by the editor, e.g. `typescript`. */
  readonly languageId: string | null;
  /** Whether the active buffer has unsaved changes. */
  readonly dirty: boolean;
}

/** Default context used before the UI reports anything. */
export const EMPTY_EDITOR_CONTEXT: EditorContext = Object.freeze({
  activeFile: null,
  selection: null,
  cursor: { line: 1, column: 1 },
  openFiles: [],
  languageId: null,
  dirty: false,
});

/** Observer invoked whenever the context changes. */
export type EditorContextListener = (context: EditorContext) => void;

/**
 * Observable holder for the editor's live context.
 */
export class EditorContextStore {
  private context: EditorContext = EMPTY_EDITOR_CONTEXT;
  private readonly listeners = new Set<EditorContextListener>();

  /** Replace the whole context. */
  public set(context: EditorContext): void {
    this.context = Object.freeze({ ...context });
    this.emit();
  }

  /** Merge a partial update into the current context. */
  public update(partial: Partial<EditorContext>): void {
    this.set({ ...this.context, ...partial });
  }

  /** Current context. */
  public get(): EditorContext {
    return this.context;
  }

  /**
   * Subscribe to context changes.
   *
   * @returns An unsubscribe function.
   */
  public subscribe(listener: EditorContextListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.context);
    }
  }
}

/**
 * Create the `get_editor_context` tool.
 *
 * @param store - The live editor-state store.
 */
export function createEditorTools(store: EditorContextStore): ToolRegistration[] {
  const definition: ToolDefinition = {
    name: 'get_editor_context',
    description:
      'Return the current editor state: active file, text selection, cursor ' +
      'line/column, open files and language id.',
    inputSchema: z.object({}),
  };

  const handler: AnyToolHandler = () => jsonResult(store.get());

  return [{ definition, handler }];
}
