/**
 * Built-in editor-context tool.
 *
 * The editor UI pushes its live state (active file, selection, cursor position,
 * open tabs) into an {@link EditorContextStore} through `set_editor_context`,
 * and the `get_editor_context` tool reads that store. That pairing is how an
 * agent knows what the user is looking at without polling the UI.
 *
 * The write side exists as a tool rather than as handle surgery because the UI
 * reaches the core the same way the agent does — over MCP, through the shell's
 * `call_core_tool` — so a second channel would be a second protocol to keep
 * honest.
 *
 * @module common/mcp/tools/editorTools
 */

import * as z from 'zod/v4';
import { defaultLanguageId } from '../../lsp/languageService.ts';
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

/** Mutable shape used to build a patch; {@link EditorContext} is readonly. */
type EditorContextPatch = { -readonly [K in keyof EditorContext]?: EditorContext[K] };

/** A 1-based cursor position, as reported by the editor. */
const positionSchema = z.object({
  line: z.number().int().min(1),
  column: z.number().int().min(1),
});

/** A 1-based selection range. */
const selectionSchema = z.object({ start: positionSchema, end: positionSchema });

/**
 * A partial editor-state report. Every field is optional: the UI sends what
 * changed, and the fields it leaves out keep their previous value.
 */
const contextSchema = z.object({
  activeFile: z.string().nullable().optional(),
  selection: selectionSchema.nullable().optional(),
  cursor: positionSchema.optional(),
  openFiles: z.array(z.string()).optional(),
  languageId: z.string().nullable().optional(),
  dirty: z.boolean().optional(),
});

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
 * Create the editor-context tools.
 *
 * Both halves of the store live here: `set_editor_context` is the UI telling the
 * core what is on screen, `get_editor_context` is the agent asking.
 *
 * @param store - The live editor-state store.
 */
export function createEditorTools(store: EditorContextStore): ToolRegistration[] {
  const getDefinition: ToolDefinition = {
    name: 'get_editor_context',
    description:
      'Return the current editor state: active file, text selection, cursor ' +
      'line/column, open files and language id.',
    inputSchema: z.object({}),
  };

  const getHandler: AnyToolHandler = () => jsonResult(store.get());

  const setDefinition: ToolDefinition<typeof contextSchema> = {
    name: 'set_editor_context',
    description:
      'Report the editor state the UI is showing: active file, cursor ' +
      'line/column, selection, open files and whether the active buffer has ' +
      'unsaved changes. Fields left out keep their previous value; ' +
      '`languageId` is derived from `activeFile` when omitted.',
    inputSchema: contextSchema,
  };

  const setHandler: AnyToolHandler = (args: z.infer<typeof contextSchema>) => {
    const patch: EditorContextPatch = {};
    if (args.activeFile !== undefined) patch.activeFile = args.activeFile;
    if (args.selection !== undefined) patch.selection = args.selection;
    if (args.cursor !== undefined) patch.cursor = args.cursor;
    if (args.openFiles !== undefined) patch.openFiles = [...args.openFiles];
    if (args.languageId !== undefined) patch.languageId = args.languageId;
    if (args.dirty !== undefined) patch.dirty = args.dirty;

    // Derived in the core on purpose: the extension map stays in one place, and
    // the UI may only import *types* from the core, so it could not reuse it.
    // `languageId` tracks `activeFile`, so closing the file clears it too.
    if (args.languageId === undefined) {
      if (typeof args.activeFile === 'string') {
        patch.languageId = defaultLanguageId(args.activeFile);
      } else if (args.activeFile === null) {
        patch.languageId = null;
      }
    }

    store.update(patch);
    return jsonResult(store.get());
  };

  return [
    { definition: getDefinition, handler: getHandler },
    { definition: setDefinition, handler: setHandler },
  ];
}
