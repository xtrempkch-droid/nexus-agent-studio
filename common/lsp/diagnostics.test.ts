/**
 * Tests for the LSP → inline-hint mapping.
 *
 * @module common/lsp/diagnostics.test
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  lspSeverityToHint,
  toInlineHints,
  uriToWorkspacePath,
  type PublishDiagnosticsParams,
} from './diagnostics.ts';

const ROOT = '/home/dev/project';

describe('lspSeverityToHint', () => {
  it('maps the LSP levels onto the editor severities', () => {
    expect(lspSeverityToHint(1)).toBe('error');
    expect(lspSeverityToHint(2)).toBe('warning');
    expect(lspSeverityToHint(3)).toBe('info');
    expect(lspSeverityToHint(4)).toBe('info');
    expect(lspSeverityToHint(undefined)).toBe('info');
  });
});

describe('uriToWorkspacePath', () => {
  it('converts a file URI inside the workspace to a relative POSIX path', () => {
    const uri = pathToFileURL(join(ROOT, 'src', 'main.ts')).href;
    expect(uriToWorkspacePath(uri, ROOT)).toBe('src/main.ts');
  });

  it('decodes percent-encoded characters that pathToFileURL produced', () => {
    const uri = pathToFileURL(join(ROOT, 'src', 'my file.ts')).href;
    expect(uri).toContain('%20');
    expect(uriToWorkspacePath(uri, ROOT)).toBe('src/my file.ts');
  });

  it('rejects a URI outside the workspace', () => {
    const uri = pathToFileURL('/etc/passwd').href;
    expect(uriToWorkspacePath(uri, ROOT)).toBeNull();
  });

  it('rejects a non-file URI', () => {
    expect(uriToWorkspacePath('untitled:Untitled-1', ROOT)).toBeNull();
  });
});

describe('toInlineHints', () => {
  const uri = pathToFileURL(join(ROOT, 'src', 'main.ts')).href;

  it('turns diagnostics into 1-based hints with the source tag', () => {
    const params: PublishDiagnosticsParams = {
      uri,
      diagnostics: [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, severity: 1, message: 'boom' },
      ],
    };

    const hints = toInlineHints(params, ROOT, 'lsp:ts');
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      filePath: 'src/main.ts',
      line: 1,
      message: 'boom',
      severity: 'error',
      source: 'lsp:ts',
    });
  });

  it('appends the diagnostic code and origin to the message', () => {
    const params: PublishDiagnosticsParams = {
      uri,
      diagnostics: [
        {
          range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } },
          severity: 2,
          code: 2322,
          source: 'typescript',
          message: 'Type mismatch',
        },
      ],
    };

    const [hint] = toInlineHints(params, ROOT, 'lsp:ts');
    expect(hint?.line).toBe(5);
    expect(hint?.severity).toBe('warning');
    expect(hint?.message).toBe('Type mismatch [typescript2322]');
  });

  it('produces no hints when the URI is outside the workspace', () => {
    const outside: PublishDiagnosticsParams = {
      uri: pathToFileURL('/etc/passwd').href,
      diagnostics: [
        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'x' },
      ],
    };

    expect(toInlineHints(outside, ROOT, 'lsp:ts')).toEqual([]);
  });

  it('clamps malformed line numbers to at least 1', () => {
    const params: PublishDiagnosticsParams = {
      uri,
      diagnostics: [
        { range: { start: { line: -1, character: 0 }, end: { line: -1, character: 0 } }, message: 'odd' },
      ],
    };

    expect(toInlineHints(params, ROOT, 'lsp:ts')[0]?.line).toBe(1);
  });
});
