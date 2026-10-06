/**
 * Built-in Docker terminal tool.
 *
 * `run_terminal_command` executes a shell command inside a hardened, throwaway
 * container (see {@link DockerSandbox}). After every run it:
 *
 * 1. records the container execution (id, command, exit code, duration) in the
 *    {@link ExecutionLogger};
 * 2. parses `stderr` for compiler diagnostics;
 * 3. attaches each diagnostic to the exact file/line as an inline hint.
 *
 * Diagnostics produced by the previous run of the same image are cleared first,
 * so stale errors never accumulate.
 *
 * @module common/mcp/tools/terminalTools
 */

import { isAbsolute, relative, resolve } from 'node:path';
import * as z from 'zod/v4';
import { DockerSandbox, type DockerRunOptions, type DockerRunResult } from '../../docker/sandbox.ts';
import {
  formatDiagnostic,
  parseCompilerErrors,
  type CompilerDiagnostic,
} from '../../docker/compilerErrorParser.ts';
import type { ExecutionLogger } from '../../debug/logger.ts';
import {
  errorResult,
  jsonResult,
  type AnyToolHandler,
  type ToolDefinition,
  type ToolRegistration,
} from '../types.ts';

/** Default image used when a call does not specify one. */
export const DEFAULT_SANDBOX_IMAGE = 'gcc:latest';

/** Dependencies and defaults for the terminal tool. */
export interface TerminalToolsOptions {
  /** Absolute workspace root, mounted at `/workspace`. */
  readonly workspaceRoot: string;
  /** Logger that receives container run records. */
  readonly logger: ExecutionLogger;
  /** Sandbox instance. Defaults to one using the real Docker CLI. */
  readonly sandbox?: DockerSandbox;
  /** Image used when a call omits `image`. */
  readonly defaultImage?: string;
  /** Command timeout in milliseconds. */
  readonly defaultTimeoutMs?: number;
}

/**
 * Runner handed to plugins through `PluginContext.terminal`, so a plugin can
 * execute code without importing the Docker layer directly.
 */
export interface TerminalRunner {
  /**
   * Execute a command inside the sandbox.
   *
   * @param command - Shell command to run.
   * @param options - Per-call overrides.
   */
  run(command: string, options?: Partial<DockerRunOptions>): Promise<DockerRunResult>;
}

/**
 * Normalize a compiler-reported path to a workspace-relative, POSIX-style path.
 * Paths the compiler resolved inside `/workspace` (or the mount point) become
 * relative; anything outside is returned unchanged.
 */
function normalizeDiagnosticPath(filePath: string, workspaceRoot: string, mountPoint: string): string {
  const cleaned = filePath.replace(/^\.\//u, '');

  if (cleaned.startsWith(mountPoint)) {
    const withoutMount = cleaned.slice(mountPoint.length).replace(/^[/\\]/u, '');
    return withoutMount.split(/[\\/]/u).join('/');
  }

  if (isAbsolute(cleaned)) {
    const rel = relative(resolve(workspaceRoot), resolve(cleaned));
    if (!rel.startsWith('..')) {
      return rel.split(/[\\/]/u).join('/');
    }
  }

  return cleaned.split(/[\\/]/u).join('/');
}

/**
 * Build a {@link TerminalRunner} bound to a workspace.
 */
export function createTerminalRunner(options: TerminalToolsOptions): TerminalRunner {
  const sandbox = options.sandbox ?? new DockerSandbox();
  const defaultImage = options.defaultImage ?? DEFAULT_SANDBOX_IMAGE;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;

  return {
    run: (command, overrides = {}) =>
      sandbox.run({
        image: overrides.image ?? defaultImage,
        command,
        workspaceDir: options.workspaceRoot,
        ...(overrides.network === undefined ? {} : { network: overrides.network }),
        ...(overrides.memory === undefined ? {} : { memory: overrides.memory }),
        ...(overrides.cpus === undefined ? {} : { cpus: overrides.cpus }),
        timeoutMs: overrides.timeoutMs ?? defaultTimeoutMs,
        ...(overrides.env === undefined ? {} : { env: overrides.env }),
        ...(overrides.extraArgs === undefined ? {} : { extraArgs: overrides.extraArgs }),
      }),
  };
}

/**
 * Create the `run_terminal_command` tool.
 *
 * @param options - Workspace root, logger and sandbox configuration.
 */
export function createTerminalTools(options: TerminalToolsOptions): ToolRegistration[] {
  const { workspaceRoot, logger } = options;
  const defaultImage = options.defaultImage ?? DEFAULT_SANDBOX_IMAGE;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
  const sandbox = options.sandbox ?? new DockerSandbox();
  const mountPoint = '/workspace';

  const definition: ToolDefinition = {
    name: 'run_terminal_command',
    description:
      'Run a shell command in an isolated Docker container (no network by ' +
      'default, all capabilities dropped, memory/CPU capped, auto-removed). ' +
      'Compilation errors found on stderr are reported as inline hints.',
    inputSchema: z.object({
      command: z.string().min(1).describe('Shell command, e.g. "npm test" or "gcc -o app main.c".'),
      image: z
        .string()
        .default(DEFAULT_SANDBOX_IMAGE)
        .describe('Container image. Defaults to gcc:latest.'),
      network: z
        .enum(['none', 'bridge', 'host'])
        .default('none')
        .describe('Network mode. Defaults to none (fully isolated).'),
      timeoutMs: z
        .number()
        .int()
        .min(1000)
        .max(600_000)
        .default(defaultTimeoutMs)
        .describe('Kill the container after this many milliseconds.'),
    }),
  };

  const handler: AnyToolHandler = async ({ command, image, network, timeoutMs }) => {
    const source = `docker:${image}`;

    // Clear diagnostics from the previous run of this image.
    logger.hints.clearSource(source);

    const result = await sandbox.run({
      image,
      command,
      workspaceDir: workspaceRoot,
      network,
      timeoutMs,
    });

    logger.recordContainerRun({
      containerId: result.containerId,
      image: result.image,
      command: result.command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      startedAt: result.startedAt,
    });

    const diagnostics: CompilerDiagnostic[] = parseCompilerErrors(result.stderr).map(
      (diagnostic) => ({
        ...diagnostic,
        filePath: normalizeDiagnosticPath(diagnostic.filePath, workspaceRoot, mountPoint),
      }),
    );

    for (const diagnostic of diagnostics) {
      logger.addInlineHint({
        filePath: diagnostic.filePath,
        line: diagnostic.line,
        message: formatDiagnostic(diagnostic),
        severity: diagnostic.severity,
        source,
        ...(diagnostic.code === undefined ? {} : { codeFix: diagnostic.code }),
      });
    }

    if (result.timedOut) {
      return errorResult(
        JSON.stringify(
          {
            containerId: result.containerId,
            timedOut: true,
            durationMs: result.durationMs,
            stdout: result.stdout,
            stderr: result.stderr,
          },
          null,
          2,
        ),
      );
    }

    return jsonResult({
      containerId: result.containerId,
      image: result.image,
      command: result.command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      diagnostics,
    });
  };

  return [{ definition, handler }];
}
