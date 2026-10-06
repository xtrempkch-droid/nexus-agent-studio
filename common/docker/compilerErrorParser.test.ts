import { describe, expect, it } from 'vitest';
import { formatDiagnostic, parseCompilerErrors } from './compilerErrorParser.ts';

describe('parseCompilerErrors', () => {
  it('parses GCC / Clang diagnostics with a column', () => {
    const stderr = [
      'src/main.c:12:5: error: expected declaration specifiers',
      'src/main.c:20:1: warning: unused variable \'x\'',
    ].join('\n');

    const diagnostics = parseCompilerErrors(stderr);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      filePath: 'src/main.c',
      line: 12,
      column: 5,
      severity: 'error',
      toolchain: 'gcc',
    });
    expect(diagnostics[1]).toMatchObject({ line: 20, severity: 'warning' });
  });

  it('parses GCC output without a column', () => {
    const diagnostics = parseCompilerErrors('lib/util.c:9: error: unknown type name');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      filePath: 'lib/util.c',
      line: 9,
      severity: 'error',
      toolchain: 'gcc',
    });
  });

  it('parses TypeScript diagnostics with an error code', () => {
    const diagnostics = parseCompilerErrors(
      "src/index.ts(4,18): error TS2322: Type 'string' is not assignable to type 'number'.",
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      filePath: 'src/index.ts',
      line: 4,
      column: 18,
      severity: 'error',
      code: 'TS2322',
      toolchain: 'typescript',
    });
  });

  it('parses Rustc diagnostics with the following location line', () => {
    const stderr = [
      'error[E0425]: cannot find value `foo` in this scope',
      '  --> src/main.rs:7:9',
      '   |',
      ' 7 |     foo();',
    ].join('\n');

    const diagnostics = parseCompilerErrors(stderr);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      filePath: 'src/main.rs',
      line: 7,
      column: 9,
      severity: 'error',
      code: 'E0425',
      toolchain: 'rustc',
    });
  });

  it('returns an empty array when nothing matches', () => {
    expect(parseCompilerErrors('all good\nnothing to see here')).toEqual([]);
  });

  it('ignores blank lines', () => {
    expect(parseCompilerErrors('\n\n   \n')).toEqual([]);
  });
});

describe('formatDiagnostic', () => {
  it('renders file:line:col with severity and code', () => {
    const [diagnostic] = parseCompilerErrors('src/a.ts(2,3): error TS1005: ...');
    expect(diagnostic).toBeDefined();
    expect(formatDiagnostic(diagnostic!)).toBe('src/a.ts:2:3: error [TS1005]: ...');
  });
});
