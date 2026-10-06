/**
 * Unisolated local command runner.
 *
 * The project's promise is a **sandboxed** terminal: `DockerSandbox` runs every
 * command in a throwaway container with no network and no capabilities, and that
 * remains the default. This file exists because a sandbox that cannot run at all
 * is not safer, it is just broken — on a machine without Docker the terminal did
 * nothing but explain itself.
 *
 * So this is the **opt-in** alternative, and it is deliberately loud about what
 * it is not:
 *
 * - it is never selected implicitly; the caller has to ask for it;
 * - it reports `image: 'local (sem isolamento)'` in every result, so the
 *   execution log and the UI carry the truth about how the command ran;
 * - it ignores the isolation options rather than pretending to honour them.
 *
 * It implements the same `run` contract as the Docker sandbox, so swapping one
 * for the other changes no caller — only the guarantees.
 *
 * @module common/docker/localRunner
 */

import {
  defaultCommandExecutor,
  type CommandExecutor,
  type DockerRunOptions,
  type DockerRunResult,
} from './sandbox.ts';

/** What every run reports as its image when nothing was isolated. */
export const UNSANDBOXED_IMAGE_LABEL = 'local (sem isolamento)';

/**
 * The argv that runs `command` through a shell on `platform`.
 *
 * Extracted and parameterised so both branches are testable from either CI
 * runner, rather than leaving the Windows path to be discovered in production.
 */
export function shellArgv(command: string, platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32'
    ? ['cmd.exe', '/d', '/s', '/c', command]
    : ['sh', '-lc', command];
}

/** Runs commands directly on the host, with no isolation whatsoever. */
export class LocalRunner {
  /**
   * @param executor - Process runner; defaults to {@link defaultCommandExecutor}.
   * @param platform - Which shell to build; injectable so the argv can be
   * asserted for either platform from either CI runner.
   */
  public constructor(
    private readonly executor: CommandExecutor = defaultCommandExecutor,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  /**
   * Run `options.command` in `options.workspaceDir`.
   *
   * `image`, `network`, `memory` and `cpus` are accepted and **ignored**: they
   * describe a container, and there is no container. Ignoring them is the point
   * of the type-compatible signature — but the result says so.
   */
  public async run(options: DockerRunOptions): Promise<DockerRunResult> {
    const startedAt = Date.now();
    const result = await this.executor({
      argv: shellArgv(options.command, this.platform),
      timeoutMs: options.timeoutMs ?? 120_000,
      cwd: options.workspaceDir,
    });

    return {
      containerId: `local-${String(process.pid)}`,
      image: UNSANDBOXED_IMAGE_LABEL,
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
