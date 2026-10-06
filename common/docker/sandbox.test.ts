import { describe, expect, it } from 'vitest';
import {
  DockerSandbox,
  type CommandExecutionResult,
  type CommandExecutor,
} from './sandbox.ts';

const SUCCESS: CommandExecutionResult = {
  exitCode: 0,
  stdout: 'ok',
  stderr: '',
  timedOut: false,
};

interface Harness {
  readonly sandbox: DockerSandbox;
  readonly calls: Array<{ argv: string[]; timeoutMs: number }>;
}

function createHarness(result: CommandExecutionResult = SUCCESS): Harness {
  const calls: Array<{ argv: string[]; timeoutMs: number }> = [];
  const executor: CommandExecutor = async (request) => {
    calls.push({ argv: [...request.argv], timeoutMs: request.timeoutMs });
    return result;
  };
  return { sandbox: new DockerSandbox(executor), calls };
}

describe('DockerSandbox.buildArgv', () => {
  it('applies every isolation flag', () => {
    const { sandbox } = createHarness();
    const argv = sandbox.buildArgv({
      image: 'gcc:latest',
      command: 'make',
      workspaceDir: '/home/dev/project',
    });

    expect(argv.slice(0, 2)).toEqual(['run', '--rm']);
    expect(argv).toContain('--name');
    expect(argv).toContain('--cap-drop');
    expect(argv[argv.indexOf('--cap-drop') + 1]).toBe('ALL');
    expect(argv).toContain('--security-opt');
    expect(argv[argv.indexOf('--security-opt') + 1]).toBe('no-new-privileges');
    expect(argv[argv.indexOf('--network') + 1]).toBe('none');
    expect(argv[argv.indexOf('--memory') + 1]).toBe('512m');
    expect(argv[argv.indexOf('--cpus') + 1]).toBe('1.0');
    expect(argv[argv.indexOf('-v') + 1]).toBe('/home/dev/project:/workspace');
    expect(argv[argv.indexOf('-w') + 1]).toBe('/workspace');
  });

  it('places the image and command last, running through sh -lc', () => {
    const { sandbox } = createHarness();
    const argv = sandbox.buildArgv({
      image: 'node:22-alpine',
      command: 'npm test',
      workspaceDir: '/w',
    });

    expect(argv.slice(-4)).toEqual(['node:22-alpine', 'sh', '-lc', 'npm test']);
  });

  it('honours overrides for network, memory and cpus', () => {
    const { sandbox } = createHarness();
    const argv = sandbox.buildArgv({
      image: 'alpine',
      command: 'true',
      workspaceDir: '/w',
      network: 'bridge',
      memory: '1g',
      cpus: '2.5',
      containerWorkspaceDir: '/code',
    });

    expect(argv[argv.indexOf('--network') + 1]).toBe('bridge');
    expect(argv[argv.indexOf('--memory') + 1]).toBe('1g');
    expect(argv[argv.indexOf('--cpus') + 1]).toBe('2.5');
    expect(argv[argv.indexOf('-w') + 1]).toBe('/code');
    expect(argv[argv.indexOf('-v') + 1]).toBe('/w:/code');
  });

  it('injects environment variables and extra flags before the image', () => {
    const { sandbox } = createHarness();
    const argv = sandbox.buildArgv({
      image: 'alpine',
      command: 'env',
      workspaceDir: '/w',
      env: { CI: '1', NODE_ENV: 'test' },
      extraArgs: ['--read-only'],
    });

    expect(argv).toContain('-e');
    expect(argv).toContain('CI=1');
    expect(argv).toContain('NODE_ENV=test');
    expect(argv).toContain('--read-only');
    expect(argv.indexOf('--read-only')).toBeLessThan(argv.indexOf('alpine'));
  });
});

describe('DockerSandbox.run', () => {
  it('reports the container id used on the command line', async () => {
    const { sandbox, calls } = createHarness();
    const result = await sandbox.run({
      image: 'gcc:latest',
      command: 'make',
      workspaceDir: '/w',
    });

    const argv = calls[0]?.argv ?? [];
    expect(result.containerId).toBe(argv[argv.indexOf('--name') + 1]);
    expect(result.containerId).toMatch(/^nexus-[0-9a-f]{8}$/u);
    expect(result.image).toBe('gcc:latest');
    expect(result.command).toBe('make');
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.timedOut).toBe(false);
  });

  it('separates stdout and stderr and surfaces the exit code', async () => {
    const { sandbox } = createHarness({
      exitCode: 2,
      stdout: 'compiling\n',
      stderr: 'error: boom\n',
      timedOut: false,
    });

    const result = await sandbox.run({
      image: 'gcc:latest',
      command: 'make',
      workspaceDir: '/w',
    });

    expect(result.stdout).toBe('compiling\n');
    expect(result.stderr).toBe('error: boom\n');
    expect(result.exitCode).toBe(2);
  });

  it('forwards the configured timeout to the executor', async () => {
    const { sandbox, calls } = createHarness();
    await sandbox.run({
      image: 'alpine',
      command: 'sleep 1',
      workspaceDir: '/w',
      timeoutMs: 4321,
    });

    expect(calls[0]?.timeoutMs).toBe(4321);
  });

  it('defaults the timeout to two minutes', async () => {
    const { sandbox, calls } = createHarness();
    await sandbox.run({ image: 'alpine', command: 'true', workspaceDir: '/w' });

    expect(calls[0]?.timeoutMs).toBe(120_000);
  });

  it('propagates a timeout flag from the executor', async () => {
    const { sandbox } = createHarness({
      exitCode: 124,
      stdout: '',
      stderr: '',
      timedOut: true,
    });

    const result = await sandbox.run({ image: 'alpine', command: 'sleep 999', workspaceDir: '/w' });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
  });
});
