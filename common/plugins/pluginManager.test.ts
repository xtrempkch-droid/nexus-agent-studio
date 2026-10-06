import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import { ExecutionLogger } from '../debug/logger.ts';
import { InternalMCPServer } from '../mcp/server.ts';
import type { TerminalRunner } from '../mcp/tools/terminalTools.ts';
import { PluginManager } from './pluginManager.ts';
import type { PluginLifecycle, PluginManifest, PluginModule } from './types.ts';

const VALID_MANIFEST: PluginManifest = {
  id: 'acme.demo',
  name: 'Demo',
  version: '1.2.3',
  entryPoint: 'acme/demo.ts',
  permissions: { mcpTools: true },
};

const TERMINAL: TerminalRunner = {
  run: async (command) => ({
    containerId: 'nexus-test',
    image: 'alpine',
    command,
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 1,
    startedAt: 1,
    timedOut: false,
  }),
};

interface Harness {
  readonly manager: PluginManager;
  readonly server: InternalMCPServer;
  readonly logger: ExecutionLogger;
}

function createHarness(): Harness {
  const server = new InternalMCPServer({ name: 'test', version: '1.0.0' });
  const logger = new ExecutionLogger('/workspace');
  const manager = new PluginManager({ mcp: server, logger, terminal: TERMINAL });
  return { manager, server, logger };
}

class RecordingPlugin implements PluginLifecycle {
  public loaded = false;
  public unloaded = false;
  public readonly toolName: string;

  public constructor(toolName = 'demo_tool') {
    this.toolName = toolName;
  }

  public async onLoad(context: Parameters<PluginLifecycle['onLoad']>[0]): Promise<void> {
    this.loaded = true;
    context.registerTool(
      { name: this.toolName, description: 'demo', inputSchema: z.object({}) },
      () => ({ content: [{ type: 'text', text: 'ok' }] }),
    );
  }

  public async onUnload(): Promise<void> {
    this.unloaded = true;
  }
}

class ThrowingLoadPlugin implements PluginLifecycle {
  public async onLoad(): Promise<void> {
    throw new Error('boom on load');
  }
  public async onUnload(): Promise<void> {
    /* noop */
  }
}

class ThrowingUnloadPlugin implements PluginLifecycle {
  public async onLoad(): Promise<void> {
    /* noop */
  }
  public async onUnload(): Promise<void> {
    throw new Error('boom on unload');
  }
}

function moduleOf(manifest: PluginManifest, lifecycle: PluginLifecycle): PluginModule {
  return { manifest, lifecycle };
}

describe('PluginManager.validateManifest', () => {
  it('accepts a valid manifest', () => {
    const { manager } = createHarness();
    expect(manager.validateManifest(VALID_MANIFEST)).toEqual([]);
  });

  it('rejects a malformed id', () => {
    const { manager } = createHarness();
    const issues = manager.validateManifest({ ...VALID_MANIFEST, id: 'Bad ID!' });
    expect(issues.some((issue) => issue.field === 'id')).toBe(true);
  });

  it('rejects a non-semver version', () => {
    const { manager } = createHarness();
    const issues = manager.validateManifest({ ...VALID_MANIFEST, version: 'v1' });
    expect(issues.some((issue) => issue.field === 'version')).toBe(true);
  });

  it('rejects an empty name and entry point', () => {
    const { manager } = createHarness();
    const issues = manager.validateManifest({ ...VALID_MANIFEST, name: '  ', entryPoint: '' });
    expect(issues.map((issue) => issue.field).sort()).toEqual(['entryPoint', 'name']);
  });
});

describe('PluginManager.load', () => {
  it('runs onLoad and registers the plugin tools', async () => {
    const { manager, server } = createHarness();
    const plugin = new RecordingPlugin();

    const loaded = await manager.load(moduleOf(VALID_MANIFEST, plugin));

    expect(plugin.loaded).toBe(true);
    expect(server.getToolNames()).toEqual(['demo_tool']);
    expect(loaded.registeredTools).toEqual(['demo_tool']);
    expect(manager.isLoaded(VALID_MANIFEST.id)).toBe(true);
  });

  it('logs a plugin_loaded event', async () => {
    const { manager, logger } = createHarness();
    await manager.load(moduleOf(VALID_MANIFEST, new RecordingPlugin()));

    expect(logger.getEntries().some((entry) => entry.action === 'plugin_loaded')).toBe(true);
  });

  it('refuses to load the same plugin twice', async () => {
    const { manager } = createHarness();
    await manager.load(moduleOf(VALID_MANIFEST, new RecordingPlugin()));

    await expect(manager.load(moduleOf(VALID_MANIFEST, new RecordingPlugin('other')))).rejects.toThrow(
      /already loaded/u,
    );
  });

  it('rejects an invalid manifest before touching the registry', async () => {
    const { manager, server } = createHarness();

    await expect(
      manager.load(moduleOf({ ...VALID_MANIFEST, version: 'nope' }, new RecordingPlugin())),
    ).rejects.toThrow(/Invalid plugin manifest/u);

    expect(server.getToolNames()).toEqual([]);
  });

  it('isolates a throwing onLoad and leaves no dangling tools', async () => {
    const { manager, server, logger } = createHarness();

    await expect(manager.load(moduleOf(VALID_MANIFEST, new ThrowingLoadPlugin()))).rejects.toThrow(
      /failed to load/u,
    );

    expect(server.getToolNames()).toEqual([]);
    expect(manager.isLoaded(VALID_MANIFEST.id)).toBe(false);
    expect(logger.getEntries().some((entry) => entry.action === 'plugin_load_failed')).toBe(true);
  });
});

describe('PluginManager.unload', () => {
  it('removes the tools and calls onUnload', async () => {
    const { manager, server } = createHarness();
    const plugin = new RecordingPlugin();
    await manager.load(moduleOf(VALID_MANIFEST, plugin));

    const result = await manager.unload(VALID_MANIFEST.id);

    expect(result).toBe(true);
    expect(plugin.unloaded).toBe(true);
    expect(server.getToolNames()).toEqual([]);
    expect(manager.isLoaded(VALID_MANIFEST.id)).toBe(false);
  });

  it('returns false for an unknown plugin', async () => {
    const { manager } = createHarness();
    expect(await manager.unload('nope')).toBe(false);
  });

  it('swallows a throwing onUnload and still reports success', async () => {
    const { manager, logger } = createHarness();
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await manager.load(moduleOf(VALID_MANIFEST, new ThrowingUnloadPlugin()));

    await expect(manager.unload(VALID_MANIFEST.id)).resolves.toBe(true);
    expect(logger.getEntries().some((entry) => entry.action === 'plugin_unload_error')).toBe(true);
    warn.mockRestore();
  });
});

describe('PluginManager.unloadAll and getLoaded', () => {
  it('unloads every plugin and keeps load order', async () => {
    const { manager, server } = createHarness();

    await manager.load(moduleOf(VALID_MANIFEST, new RecordingPlugin('first')));
    await manager.load(
      moduleOf({ ...VALID_MANIFEST, id: 'acme.second', name: 'Second' }, new RecordingPlugin('second')),
    );

    expect(manager.getLoaded().map((plugin) => plugin.manifest.id)).toEqual([
      'acme.demo',
      'acme.second',
    ]);

    await manager.unloadAll();

    expect(manager.getLoaded()).toEqual([]);
    expect(server.getToolNames()).toEqual([]);
  });
});
