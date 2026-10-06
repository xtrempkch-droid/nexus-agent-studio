/**
 * Tests for the terminal tool's option plumbing.
 *
 * `DockerSandbox` owns the isolation flags and has its own suite; what this file
 * guards is that the caller's choices actually **reach** it. That is not a
 * theoretical worry: the sandbox was handed an argv without the `docker` binary
 * for as long as the tests only ever looked at the sandbox in isolation, and the
 * same class of gap appears whenever an option is accepted and then dropped on
 * the way down.
 *
 * @module common/mcp/tools/terminalTools.test
 */

import { describe, expect, it } from 'vitest';
import type { DockerRunOptions, DockerRunResult, Sandbox } from '../../docker/sandbox.ts';
import { ExecutionLogger } from '../../debug/logger.ts';
import { createTerminalRunner, createTerminalTools } from './terminalTools.ts';

/** Records the options it was asked to run and answers with a canned result. */
function recordingSandbox(): { readonly options: DockerRunOptions[]; readonly sandbox: Sandbox } {
  const options: DockerRunOptions[] = [];
  return {
    options,
    sandbox: {
      run: (request) => {
        options.push(request);
        return Promise.resolve<DockerRunResult>({
          containerId: 'nexus-test',
          image: request.image,
          command: request.command,
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 1,
          startedAt: Date.now(),
          timedOut: false,
        });
      },
    },
  };
}

function logger(): ExecutionLogger {
  return new ExecutionLogger('/ws');
}

describe('createTerminalRunner', () => {
  it('asks for a hardened container by default', async () => {
    const { options, sandbox } = recordingSandbox();

    await createTerminalRunner({ workspaceRoot: '/ws', logger: logger(), sandbox }).run('echo hi');

    expect(options[0]?.noNewPrivileges).toBe(true);
  });

  it('passes an explicit opt-out through to the sandbox', async () => {
    const { options, sandbox } = recordingSandbox();

    await createTerminalRunner({
      workspaceRoot: '/ws',
      logger: logger(),
      sandbox,
      noNewPrivileges: false,
    }).run('echo hi');

    expect(options[0]?.noNewPrivileges).toBe(false);
  });

  it('leaves the workspace and image in the caller\u2019s hands', async () => {
    const { options, sandbox } = recordingSandbox();

    await createTerminalRunner({ workspaceRoot: '/project', logger: logger(), sandbox }).run(
      'make',
      { image: 'gcc:latest' },
    );

    expect(options[0]).toMatchObject({
      image: 'gcc:latest',
      command: 'make',
      workspaceDir: '/project',
    });
  });
});

describe('createTerminalTools', () => {
  it('threads the opt-out from the tool options into the run', async () => {
    const { options, sandbox } = recordingSandbox();
    const tools = createTerminalTools({
      workspaceRoot: '/ws',
      logger: logger(),
      sandbox,
      noNewPrivileges: false,
    });
    const tool = tools.find((candidate) => candidate.definition.name === 'run_terminal_command');
    if (tool === undefined) {
      throw new Error('run_terminal_command was not registered');
    }

    await tool.handler({ command: 'ls', image: 'alpine', network: 'none', timeoutMs: 5000 });

    expect(options[0]?.noNewPrivileges).toBe(false);
  });
});
