/**
 * Docker terminal sandbox.
 *
 * Executes an arbitrary shell command inside a throwaway container with a strict
 * isolation posture. The container:
 *
 * - mounts the workspace read/write at `/workspace` and sets it as the CWD;
 * - runs with `--rm` so it can never outlive the call;
 * - drops **all** Linux capabilities (`--cap-drop=ALL`);
 * - forbids privilege escalation (`--security-opt=no-new-privileges`);
 * - is resource-capped (`--memory`, `--cpus`);
 * - has no network by default (`--network none`);
 * - inherits Docker's **default seccomp profile**, which blocks `AF_ALG`
 *   sockets. That is the relevant mitigation for the `algif_aead` page-cache
 *   class of issues (CVE-2026-31431); the underlying fix is a kernel patch.
 *
 * `stdout` and `stderr` are always captured into separate buffers.
 *
 * @module common/docker/sandbox
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** A spawn request handed to a {@link CommandExecutor}. */
export interface CommandExecutionRequest {
  readonly argv: readonly string[];
  readonly timeoutMs: number;
  readonly cwd?: string;
}

/** Result of a spawn, independent of Docker. */
export interface CommandExecutionResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * Injectable process runner. Tests substitute this to assert the exact argv
 * without requiring a Docker daemon.
 */
export type CommandExecutor = (request: CommandExecutionRequest) => Promise<CommandExecutionResult>;

/** Options for a single sandboxed execution. */
export interface DockerRunOptions {
  /** Image to run, e.g. `gcc:latest`. */
  readonly image: string;
  /** Shell command executed inside the container. */
  readonly command: string;
  /** Host directory mounted at `/workspace`. */
  readonly workspaceDir: string;
  /** Mount point inside the container. Defaults to `/workspace`. */
  readonly containerWorkspaceDir?: string;
  /** `none` (default) fully isolates the network. */
  readonly network?: 'none' | 'bridge' | 'host';
  /** Memory limit, e.g. `512m`. */
  readonly memory?: string;
  /** CPU quota, e.g. `1.0`. */
  readonly cpus?: string;
  /** Kill the container after this many milliseconds. */
  readonly timeoutMs?: number;
  /** Environment variables injected with `-e`. */
  readonly env?: Readonly<Record<string, string>>;
  /** Escape hatch for extra `docker run` flags. */
  readonly extraArgs?: readonly string[];
}

/** Outcome of a sandboxed execution. */
export interface DockerRunResult {
  /** Container name used for correlation in the execution log. */
  readonly containerId: string;
  readonly image: string;
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly startedAt: number;
  readonly timedOut: boolean;
}

const DEFAULTS = {
  containerWorkspaceDir: '/workspace',
  network: 'none',
  memory: '512m',
  cpus: '1.0',
  timeoutMs: 120_000,
} as const;

/**
 * Default executor: spawns the toolchain binary and captures both streams.
 */
export const defaultCommandExecutor: CommandExecutor = (request) =>
  new Promise<CommandExecutionResult>((resolve) => {
    const [bin, ...args] = request.argv;
    if (bin === undefined) {
      resolve({ exitCode: 127, stdout: '', stderr: 'No command provided.', timedOut: false });
      return;
    }

    const child = spawn(bin, args, {
      cwd: request.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, request.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const finish = (exitCode: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    };

    child.on('error', (error: Error) => {
      stderr += `${error.message}\n`;
      finish(127);
    });
    child.on('close', (code: number | null) => {
      finish(code ?? (timedOut ? 124 : 1));
    });
  });

/**
 * The one capability the tools need from a sandbox: run a command and report
 * what happened.
 *
 * Declared structurally rather than as `DockerSandbox` so an unisolated runner
 * can be substituted — see `LocalRunner`. Anything satisfying this can be
 * plugged in, and the tools neither know nor care which one they were given,
 * because the **result** carries the label saying how it ran. That is what keeps
 * the substitution honest instead of silent.
 */
export type Sandbox = Pick<DockerSandbox, 'run'>;

/**
 * Builds and runs hardened `docker run` invocations.
 */
export class DockerSandbox {
  /**
   * @param executor - Process runner; defaults to {@link defaultCommandExecutor}.
   */
  public constructor(private readonly executor: CommandExecutor = defaultCommandExecutor) {}

  /**
   * Build the exact `docker run` argv for an execution. Exposed separately so it
   * can be asserted in tests and rendered in the UI.
   */
  public buildArgv(options: DockerRunOptions): string[] {
    const containerId = `nexus-${randomUUID().slice(0, 8)}`;
    const mountTarget = options.containerWorkspaceDir ?? DEFAULTS.containerWorkspaceDir;

    const argv: string[] = [
      'run',
      '--rm',
      '--name',
      containerId,
      '-v',
      `${options.workspaceDir}:${mountTarget}`,
      '-w',
      mountTarget,
      '--memory',
      options.memory ?? DEFAULTS.memory,
      '--cpus',
      options.cpus ?? DEFAULTS.cpus,
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--network',
      options.network ?? DEFAULTS.network,
    ];

    for (const [key, value] of Object.entries(options.env ?? {})) {
      argv.push('-e', `${key}=${value}`);
    }

    argv.push(...(options.extraArgs ?? []));

    // Image, then the command it runs. `sh -lc` keeps pipelines/&& working.
    argv.push(options.image, 'sh', '-lc', options.command);

    return argv;
  }

  /**
   * Run a command inside the sandbox.
   *
   * @returns A {@link DockerRunResult} including both streams and the exit code.
   */
  public async run(options: DockerRunOptions): Promise<DockerRunResult> {
    const argv = this.buildArgv(options);
    const containerId = argv[argv.indexOf('--name') + 1] ?? 'unknown';
    const startedAt = Date.now();

    const result = await this.executor({
      argv,
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      cwd: options.workspaceDir,
    });

    return {
      containerId,
      image: options.image,
      command: options.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
      startedAt,
      timedOut: result.timedOut,
    };
  }
}
