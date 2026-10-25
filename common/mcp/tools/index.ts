/**
 * Barrel for the built-in MCP tools.
 *
 * Import order mirrors the tool groups surfaced to the agent: files, editor
 * context, then the Docker terminal, project memory and the web.
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

export { createLspTools, type LspToolsOptions } from './lspTools.ts';

export {
  createMemoryTools,
  readMemorySection,
  appendMemoryFact,
  MEMORY_FILE,
  MEMORY_HEADING,
  type MemoryToolsOptions,
  type MemorySection,
} from './memoryTools.ts';

export {
  createWebTools,
  webAccessFromEnvironment,
  WEB_ACCESS_ENV,
  type WebToolsOptions,
} from './webTools.ts';

export { writeFileAtomically } from './atomicWrite.ts';
