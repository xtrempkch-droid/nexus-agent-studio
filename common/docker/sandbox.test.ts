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
  it('produces a complete argv, starting with the binary the executor spawns', () => {
    // The regression this pins: the argv used to start at `run`, so the real
    // executor called `spawn('run')` and every sandboxed command failed with
    // ENOENT and exit 127 — invisible to the other tests here, because they all
    // inject an executor that never spawns anything. `LocalRunner` hands the same
    // executor `['sh', '-lc', …]`, so "argv[0] is the binary" is the contract.
    const { sandbox } = createHarness();
    const argv = sandbox.buildArgv({ image: 'alpine', command: 'true', workspaceDir: '/w' });

    expect(argv[0]).toBe('docker');
    expect(argv[1]).toBe('run');
  });

  it('applies every isolation flag', () => {
    const { sandbox } = createHarness();
    const argv = sandbox.buildArgv({
      image: 'gcc:latest',
      command: 'make',
      workspaceDir: '/home/dev/project',
    });

    expect(argv.slice(0, 3)).toEqual(['docker', 'run', '--rm']);
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

  it('sets no-new-privileges by default and drops it only when asked', () => {
    // The flag is defence in depth against a setuid binary inside the image, so
    // it is on unless the host rejects it — some kernels fail every execve in
    // the container with EPERM when it is set, which breaks the sandbox instead
    // of hardening it. Off is therefore explicit, never a default.
    const { sandbox } = createHarness();
    const base = { image: 'alpine', command: 'true', workspaceDir: '/w' };

    const hardened = sandbox.buildArgv(base);
    expect(hardened[hardened.indexOf('--security-opt') + 1]).toBe('no-new-privileges');

    const relaxed = sandbox.buildArgv({ ...base, noNewPrivileges: false });
    expect(relaxed).not.toContain('--security-opt');
    expect(relaxed).toContain('--cap-drop');
  });

  it('runs as the requested user, with a writable HOME', () => {
    // `--cap-drop ALL` on root removes `CAP_DAC_OVERRIDE`, so a container that
    // stayed root could not write a workspace owned by the desktop user at all
    // (`Permission denied`), and the files it could write would be owned by
    // root inside the user's project.
    const { sandbox } = createHarness();
    const argv = sandbox.buildArgv({
      image: 'alpine',
      command: 'true',
      workspaceDir: '/w',
      user: '1234:5678',
    });

    expect(argv[argv.indexOf('--user') + 1]).toBe('1234:5678');
    expect(argv).toContain('HOME=/tmp');
  });

  it('keeps an explicit HOME instead of overriding it', () => {
    const { sandbox } = createHarness();
    const argv = sandbox.buildArgv({
      image: 'alpine',
      command: 'true',
      workspaceDir: '/w',
      user: '1234:5678',
      env: { HOME: '/opt/home' },
    });

    expect(argv).toContain('HOME=/opt/home');
    expect(argv).not.toContain('HOME=/tmp');
  });

  it('accepts an explicit root user', () => {
    const { sandbox } = createHarness();
    const argv = sandbox.buildArgv({
      image: 'alpine',
      command: 'true',
      workspaceDir: '/w',
      user: '0:0',
    });

    expect(argv[argv.indexOf('--user') + 1]).toBe('0:0');
  });

  // The default only exists where there is a `uid` to default to, and CI runs
  // on Windows as well: asserting a POSIX default there would fail for a reason
  // that is not a bug.
  it.skipIf(process.getuid === undefined)('defaults to the current user on POSIX', () => {
    const { sandbox } = createHarness();
    const argv = sandbox.buildArgv({ image: 'alpine', command: 'true', workspaceDir: '/w' });

    expect(argv[argv.indexOf('--user') + 1]).toBe(`${String(process.getuid?.())}:${String(process.getgid?.())}`);
    expect(argv).toContain('HOME=/tmp');
  });

  it.skipIf(process.getuid !== undefined)('omits the user flag where there is no uid', () => {
    const { sandbox } = createHarness();
    const argv = sandbox.buildArgv({ image: 'alpine', command: 'true', workspaceDir: '/w' });

    expect(argv).not.toContain('--user');
    expect(argv).not.toContain('HOME=/tmp');
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
