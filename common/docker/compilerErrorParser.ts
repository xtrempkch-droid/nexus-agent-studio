/**
 * Compiler error parser.
 *
 * Turns raw `stderr` from a sandboxed toolchain into structured diagnostics that
 * can be attached as inline hints at the exact file/line. Supported formats:
 *
 * - **GCC / Clang**  `path/file.c:12:5: error: message`
 * - **TypeScript**   `path/file.ts(12,5): error TS1234: message`
 * - **Rustc**        `error[E0123]: message` followed by ` --> path/file.rs:12:5`
 *
 * @module common/docker/compilerErrorParser
 */

import type { HintSeverity } from '../debug/hints.ts';

/** A single parsed compiler diagnostic. */
export interface CompilerDiagnostic {
  /** Path exactly as reported by the compiler (may be relative). */
  readonly filePath: string;
  /** 1-based line number. */
  readonly line: number;
  /** 1-based column, when the compiler reported one. */
  readonly column?: number;
  readonly message: string;
  readonly severity: HintSeverity;
  /** Compiler-specific code, e.g. `TS1234` or `E0123`. */
  readonly code?: string;
  /** Which toolchain produced the diagnostic. */
  readonly toolchain: 'gcc' | 'clang' | 'typescript' | 'rustc' | 'unknown';
}

/** GCC/Clang: `file.c:12:5: error: something went wrong` */
const GCC_LIKE =
  /^(?<file>.+?):(?<line>\d+):(?<col>\d+):\s*(?<sev>fatal error|error|warning|note):\s*(?<msg>.+)$/u;

/** TypeScript: `file.ts(12,5): error TS1234: something went wrong` */
const TSC_LIKE =
  /^(?<file>.+?)\((?<line>\d+),(?<col>\d+)\):\s*(?<sev>error|warning)\s+(?<code>TS\d+):\s*(?<msg>.+)$/u;

/** Rustc header: `error[E0123]: something went wrong` */
const RUST_HEADER = /^(?<sev>error|warning)(?:\[(?<code>E\d+)\])?:\s*(?<msg>.+)$/u;

/** Rustc location: `  --> src/main.rs:12:5` */
const RUST_LOCATION = /^\s*-->\s*(?<file>.+?):(?<line>\d+):(?<col>\d+)\s*$/u;

const SEVERITY_MAP: Readonly<Record<string, HintSeverity>> = {
  error: 'error',
  'fatal error': 'error',
  warning: 'warning',
  note: 'info',
};

function toSeverity(raw: string | undefined): HintSeverity {
  return SEVERITY_MAP[raw ?? ''] ?? 'info';
}

function detectToolchain(filePath: string): CompilerDiagnostic['toolchain'] {
  if (/\.(rs)$/u.test(filePath)) {
    return 'rustc';
  }
  if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(filePath)) {
    return 'typescript';
  }
  if (/\.(c|cc|cpp|cxx|h|hpp)$/u.test(filePath)) {
    return 'gcc';
  }
  return 'unknown';
}

/**
 * Parse compiler output into structured diagnostics.
 *
 * @param stderr - Raw standard-error stream from the toolchain.
 * @returns Diagnostics in the order they appeared. Empty when nothing matched.
 */
export function parseCompilerErrors(stderr: string): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const lines = stderr.split(/\r?\n/u);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      continue;
    }

    const tsc = TSC_LIKE.exec(line);
    if (tsc?.groups) {
      diagnostics.push({
        filePath: tsc.groups['file'] ?? '',
        line: Number(tsc.groups['line']),
        column: Number(tsc.groups['col']),
        message: tsc.groups['msg'] ?? '',
        severity: toSeverity(tsc.groups['sev']),
        code: tsc.groups['code'],
        toolchain: 'typescript',
      });
      continue;
    }

    const gcc = GCC_LIKE.exec(line);
    if (gcc?.groups) {
      diagnostics.push({
        filePath: gcc.groups['file'] ?? '',
        line: Number(gcc.groups['line']),
        column: Number(gcc.groups['col']),
        message: gcc.groups['msg'] ?? '',
        severity: toSeverity(gcc.groups['sev']),
        toolchain: /clang/u.test(line) ? 'clang' : 'gcc',
      });
      continue;
    }

    const rust = RUST_HEADER.exec(line);
    if (rust?.groups) {
      const location = lines
        .slice(i + 1, i + 4)
        .map((candidate) => RUST_LOCATION.exec(candidate))
        .find((match) => match !== null);

      if (location?.groups) {
        diagnostics.push({
          filePath: location.groups['file'] ?? '',
          line: Number(location.groups['line']),
          column: Number(location.groups['col']),
          message: rust.groups['msg'] ?? '',
          severity: toSeverity(rust.groups['sev']),
          ...(rust.groups['code'] === undefined ? {} : { code: rust.groups['code'] }),
          toolchain: 'rustc',
        });
      } else {
        diagnostics.push({
          filePath: '<unknown>',
          line: 1,
          message: rust.groups['msg'] ?? '',
          severity: toSeverity(rust.groups['sev']),
          ...(rust.groups['code'] === undefined ? {} : { code: rust.groups['code'] }),
          toolchain: 'rustc',
        });
      }
      continue;
    }

    // Bare `file.c:12:5: error: ...` without column is also valid GCC output.
    const gccColLess = /^(?<file>.+?):(?<line>\d+):\s*(?<sev>error|warning):\s*(?<msg>.+)$/u.exec(
      line,
    );
    if (gccColLess?.groups) {
      const filePath = gccColLess.groups['file'] ?? '';
      diagnostics.push({
        filePath,
        line: Number(gccColLess.groups['line']),
        message: gccColLess.groups['msg'] ?? '',
        severity: toSeverity(gccColLess.groups['sev']),
        toolchain: detectToolchain(filePath),
      });
    }
  }

  return diagnostics;
}

/**
 * Format a diagnostic as a single-line, human-readable string.
 */
export function formatDiagnostic(diagnostic: CompilerDiagnostic): string {
  const location =
    diagnostic.column === undefined
      ? `${diagnostic.filePath}:${diagnostic.line}`
      : `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column}`;
  const code = diagnostic.code === undefined ? '' : ` [${diagnostic.code}]`;
  return `${location}: ${diagnostic.severity}${code}: ${diagnostic.message}`;
}
