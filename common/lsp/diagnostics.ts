/**
 * Mapping between LSP diagnostics and the editor's inline hints.
 *
 * The core already has a diagnostic currency — {@link InlineHint} — produced by
 * the compiler-error parser and rendered by the editor. A language server speaks
 * a different dialect: 0-based positions, numeric severities, `file://` URIs.
 * This module is the single translation point, so the rest of the codebase keeps
 * one diagnostic shape.
 *
 * Only the fields the editor actually uses are modelled; unknown LSP fields are
 * ignored rather than preserved.
 *
 * @module common/lsp/diagnostics
 */

import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InlineHint, HintSeverity } from '../debug/hints.ts';

/** A zero-based position, as LSP spells it. */
export interface LspPosition {
  readonly line: number;
  readonly character: number;
}

/** A zero-based range, as LSP spells it. */
export interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

/** The subset of an LSP `Diagnostic` this project consumes. */
export interface LspDiagnostic {
  readonly range: LspRange;
  /** 1 = Error, 2 = Warning, 3 = Information, 4 = Hint. May be absent. */
  readonly severity?: number;
  readonly code?: string | number;
  readonly source?: string;
  readonly message: string;
}

/** The `textDocument/publishDiagnostics` notification payload. */
export interface PublishDiagnosticsParams {
  readonly uri: string;
  readonly diagnostics: readonly LspDiagnostic[];
}

/**
 * Map an LSP severity number onto this project's {@link HintSeverity}.
 *
 * LSP has four levels (Error / Warning / Information / Hint); the editor has
 * three, so Information and Hint both collapse to `info`. A missing severity is
 * treated as informational, matching the LSP default.
 */
export function lspSeverityToHint(severity: number | undefined): HintSeverity {
  switch (severity) {
    case 1:
      return 'error';
    case 2:
      return 'warning';
    default:
      return 'info';
  }
}

/**
 * Convert an LSP `file://` URI to a workspace-relative POSIX path.
 *
 * Returns `null` when the URI is not a file URI, is malformed, or points outside
 * the workspace — a language server must never be able to place a hint on a file
 * the editor is not allowed to touch.
 *
 * @param uri - The `textDocument.uri` from the notification.
 * @param workspaceRoot - Absolute workspace root.
 */
export function uriToWorkspacePath(uri: string, workspaceRoot: string): string | null {
  if (!uri.startsWith('file:')) {
    return null;
  }

  let absolute: string;
  try {
    absolute = fileURLToPath(uri);
  } catch {
    return null;
  }

  const rel = relative(resolve(workspaceRoot), absolute);
  if (rel === '') {
    return '.';
  }
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return null;
  }
  return rel.split(/[\\/]/u).join('/');
}

/**
 * Build the inline hints for one `publishDiagnostics` notification.
 *
 * @param params - The notification payload.
 * @param workspaceRoot - Absolute workspace root, used to confine the hints.
 * @param source - Tag stored on every hint (e.g. `lsp:typescript`), so a later
 * run of the same server can clear exactly its own diagnostics.
 * @returns The hints, or an empty array when the URI is outside the workspace.
 */
export function toInlineHints(
  params: PublishDiagnosticsParams,
  workspaceRoot: string,
  source: string,
): Array<Omit<InlineHint, 'id'>> {
  const filePath = uriToWorkspacePath(params.uri, workspaceRoot);
  if (filePath === null) {
    return [];
  }

  return params.diagnostics.map((diagnostic) => {
    const code = diagnostic.code === undefined ? '' : ` [${diagnostic.source ?? 'lsp'}${diagnostic.code}]`;
    return {
      filePath,
      // LSP lines are 0-based; hints are 1-based, and a clamped value keeps a
      // malformed position from producing line 0.
      line: Math.max(1, diagnostic.range.start.line + 1),
      message: `${diagnostic.message}${code}`,
      severity: lspSeverityToHint(diagnostic.severity),
      source,
    };
  });
}
