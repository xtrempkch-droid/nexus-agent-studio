/**
 * Barrel for the built-in MCP tools.
 *
 * Import order mirrors the tool groups surfaced to the agent: files, editor
 * context, then the Docker terminal.
 *
 * @module common/mcp/tools
 */

export { createFileTools, type FileToolsOptions } from './fileTools.ts';
export type { ToolRegistration } from '../types.ts';

export {
  createEditorTools,
  EditorContextStore,
  EMPTY_EDITOR_CONTEXT,
  type CursorPosition,
  type EditorContext,
  type EditorContextListener,
  type TextSelection,
} from './editorTools.ts';

export {
  createTerminalTools,
  createTerminalRunner,
  DEFAULT_SANDBOX_IMAGE,
  type TerminalRunner,
  type TerminalToolsOptions,
} from './terminalTools.ts';
