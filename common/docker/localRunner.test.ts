/**
 * Tests for the unisolated local runner.
 *
 * The executor is injected, so nothing here spawns a process: what is worth
 * asserting is the **contract** — which argv is built, what the result claims
 * about itself, and that the workspace is honoured as the working directory.
 *
 * @module common/docker/localRunner.test
 */

import { describe, expect, it } from 'vitest';
import {
  type CommandExecutionRequest,
  type CommandExecutionResult,
} from './sandbox.ts';
import { LocalRunner, UNSANDBOXED_IMAGE_LABEL, shellArgv } from './localRunner.ts';

/** Records every request and answers with a canned result. */
function recordingExecutor(): {
  readonly calls: CommandExecutionRequest[];
  readonly executor: (request: CommandExecutionRequest) => Promise<CommandExecutionResult>;
} {
  const calls: CommandExecutionRequest[] = [];
  return {
    calls,
    executor: (request) => {
      calls.push(request);
      return Promise.resolve({ exitCode: 0, stdout: 'ok\n', stderr: '', timedOut: false });
    },
  };
}

describe('shellArgv', () => {
  it('uses sh -lc on POSIX', () => {
    expect(shellArgv('npm test', 'linux')).toEqual(['sh', '-lc', 'npm test']);
    expect(shellArgv('npm test', 'darwin')).toEqual(['sh', '-lc', 'npm test']);
  });

  it('uses cmd.exe on Windows', () => {
    // Asserted from any platform on purpose: leaving this branch to be
    // discovered by a Windows user would be discovering it too late.
    expect(shellArgv('npm test', 'win32')).toEqual(['cmd.exe', '/d', '/s', '/c', 'npm test']);
  });
});

describe('LocalRunner', () => {
  it('runs the command in the workspace directory', async () => {
    const { calls, executor } = recordingExecutor();
    const runner = new LocalRunner(executor);

    await runner.run({ image: 'ignored', command: 'ls', workspaceDir: '/home/dev/project' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cwd).toBe('/home/dev/project');
    // Compared against the helper rather than a literal: the shell differs by
    // platform, and asserting the literal here made the suite pass on Linux and
    // fail on Windows, which is a test bug and not a product one.
    expect(calls[0]?.argv).toEqual(shellArgv('ls'));
  });

  it('builds the argv for the injected platform', async () => {
    const { calls, executor } = recordingExecutor();

    await new LocalRunner(executor, 'win32').run({
      image: 'x',
      command: 'dir',
      workspaceDir: '/ws',
    });

    expect(calls[0]?.argv).toEqual(['cmd.exe', '/d', '/s', '/c', 'dir']);
  });

  it('labels every result as unisolated', async () => {
    // The label is the whole safety story: an execution log that cannot tell a
    // container run from a host run is worse than having no log.
    const { executor } = recordingExecutor();
    const result = await new LocalRunner(executor).run({
      image: 'python:3.12-slim',
      command: 'echo hi',
      workspaceDir: '/ws',
    });

    expect(result.image).toBe(UNSANDBOXED_IMAGE_LABEL);
    expect(result.image).toContain('sem isolamento');
    // Never the image that was asked for: nothing ran in it.
    expect(result.image).not.toBe('python:3.12-slim');
  });

  it('passes the captured streams and exit code through', async () => {
    const runner = new LocalRunner(() =>
      Promise.resolve({ exitCode: 2, stdout: 'out', stderr: 'err', timedOut: true }),
    );

    const result = await runner.run({ image: 'x', command: 'false', workspaceDir: '/ws' });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.timedOut).toBe(true);
  });

  it('runs a real command through the default executor', async () => {
    // The one test here that spawns a process, and it exists because a fake
    // executor cannot see the contract that matters: `argv[0]` must be an
    // executable. `DockerSandbox` broke exactly that — its argv started at
    // `run`, so the real executor called `spawn('run')` and every sandboxed
    // command failed with ENOENT. Pinning it on the runner that needs no Docker
    // keeps the contract covered on every CI runner.
    const runner = new LocalRunner();

    const result = await runner.run({
      image: 'ignored',
      command: 'echo nexus-argv-contract',
      workspaceDir: process.cwd(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('nexus-argv-contract');
    expect(result.stderr).not.toContain('ENOENT');
  });

  it('applies the default timeout when none is given', async () => {
    const { calls, executor } = recordingExecutor();

    await new LocalRunner(executor).run({ image: 'x', command: 'ls', workspaceDir: '/ws' });

    expect(calls[0]?.timeoutMs).toBe(120_000);
  });

  it('honours an explicit timeout', async () => {
    const { calls, executor } = recordingExecutor();

    await new LocalRunner(executor).run({
      image: 'x',
      command: 'ls',
      workspaceDir: '/ws',
      timeoutMs: 5_000,
    });

    expect(calls[0]?.timeoutMs).toBe(5_000);
  });
});
