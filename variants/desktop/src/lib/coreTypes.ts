/**
 * Type-only bridge to the headless core.
 *
 * The desktop variant must never import **values** from `common/`, because the
 * core depends on `node:*` built-ins that do not exist in the browser. Every
 * import here is `export type`, which is fully erased at build time.
 *
 * Keeping them in one module makes that constraint easy to audit.
 *
 * @module variants/desktop/src/lib/coreTypes
 */

export type { InlineHint, HintSeverity } from '@core/debug/hints.ts';
export type { LogEntry, ContainerRunRecord, LogAuthor } from '@core/debug/logger.ts';
export type { DockerRunResult } from '@core/docker/sandbox.ts';
export type { CompilerDiagnostic } from '@core/docker/compilerErrorParser.ts';
export type { EditorContext, CursorPosition, TextSelection } from '@core/mcp/tools/editorTools.ts';
export type { ThemeObject, ThemeTokens } from '@core/themes/themeManager.ts';
