/**
 * Plugin manager.
 *
 * Validates manifests, runs plugin lifecycles with **isolated exception
 * handling** — a throwing plugin can never take the core down — and guarantees
 * that a failed load leaves no dangling tool registrations.
 *
 * @module common/plugins/pluginManager
 */

import type * as z from 'zod/v4';
import type { ExecutionLogger } from '../debug/logger.ts';
import type { InternalMCPServer } from '../mcp/server.ts';
import type { ToolDefinition, ToolHandler } from '../mcp/types.ts';
import type { TerminalRunner } from '../mcp/tools/terminalTools.ts';
import type {
  LoadedPlugin,
  PluginContext,
  PluginManifest,
  PluginModule,
} from './types.ts';

/** Dependencies injected into {@link PluginManager}. */
export interface PluginManagerOptions {
  readonly mcp: InternalMCPServer;
  readonly logger: ExecutionLogger;
  readonly terminal: TerminalRunner;
}

/** A manifest validation failure. */
export interface ManifestValidationIssue {
  readonly field: string;
  readonly message: string;
}

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/u;

/**
 * Manages the load/unload lifecycle of plugins.
 */
export class PluginManager {
  private readonly loaded = new Map<string, LoadedPlugin>();

  /** @param options - The shared core services plugins may use. */
  public constructor(private readonly options: PluginManagerOptions) {}

  /**
   * Validate a manifest without loading the plugin.
   *
   * @returns An empty array when the manifest is valid.
   */
  public validateManifest(manifest: PluginManifest): ManifestValidationIssue[] {
    const issues: ManifestValidationIssue[] = [];

    if (!ID_PATTERN.test(manifest.id)) {
      issues.push({
        field: 'id',
        message: 'Must be lowercase alphanumeric with ".", "_" or "-" separators.',
      });
    }
    if (manifest.name.trim() === '') {
      issues.push({ field: 'name', message: 'Must not be empty.' });
    }
    if (!SEMVER_PATTERN.test(manifest.version)) {
      issues.push({ field: 'version', message: 'Must be a valid semver version.' });
    }
    if (manifest.entryPoint.trim() === '') {
      issues.push({ field: 'entryPoint', message: 'Must not be empty.' });
    }
    if (typeof manifest.permissions !== 'object' || manifest.permissions === null) {
      issues.push({ field: 'permissions', message: 'Must be an object (may be empty).' });
    }

    return issues;
  }

  /**
   * Load a plugin.
   *
   * On failure the plugin's tools are unregistered, so a partial `onLoad` cannot
   * leave the registry in an inconsistent state.
   *
   * @param module - Manifest plus lifecycle implementation.
   * @throws When the manifest is invalid or `onLoad` throws.
   */
  public async load(module: PluginModule): Promise<LoadedPlugin> {
    const { manifest, lifecycle } = module;

    const issues = this.validateManifest(manifest);
    if (issues.length > 0) {
      const detail = issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ');
      throw new Error(`Invalid plugin manifest for "${manifest.id}": ${detail}`);
    }

    if (this.loaded.has(manifest.id)) {
      throw new Error(`Plugin "${manifest.id}" is already loaded.`);
    }

    const registeredTools: string[] = [];
    const server = this.options.mcp;

    const context: PluginContext = {
      manifest,
      mcp: server,
      logger: this.options.logger,
      terminal: this.options.terminal,
      registerTool: <TSchema extends z.ZodType>(
        tool: ToolDefinition<TSchema>,
        handler: ToolHandler<TSchema>,
      ) => {
        server.registerDynamicTool(manifest.id, tool, handler);
        registeredTools.push(tool.name);
      },
    };

    try {
      await lifecycle.onLoad(context);
    } catch (error) {
      server.unregisterToolsByPlugin(manifest.id);
      this.options.logger.record({
        filePath: `plugin://${manifest.id}`,
        lineRange: [0, 0],
        author: 'SYSTEM',
        action: 'plugin_load_failed',
        delta: { before: '', after: (error as Error).message },
        metadata: { pluginId: manifest.id, stack: (error as Error).stack ?? null },
      });
      throw new Error(
        `Plugin "${manifest.id}" failed to load: ${(error as Error).message}`,
        { cause: error },
      );
    }

    const record: LoadedPlugin = Object.freeze({
      manifest,
      instance: lifecycle,
      loadedAt: Date.now(),
      registeredTools: Object.freeze([...registeredTools]),
    });

    this.loaded.set(manifest.id, record);

    this.options.logger.record({
      filePath: `plugin://${manifest.id}`,
      lineRange: [0, 0],
      author: 'SYSTEM',
      action: 'plugin_loaded',
      delta: { before: '', after: manifest.version },
      metadata: { pluginId: manifest.id, tools: record.registeredTools },
    });

    return record;
  }

  /**
   * Unload a plugin. Tools are removed **before** `onUnload` runs so a throwing
   * teardown still leaves the registry clean.
   *
   * @returns `true` when a plugin was unloaded.
   */
  public async unload(pluginId: string): Promise<boolean> {
    const record = this.loaded.get(pluginId);
    if (record === undefined) {
      return false;
    }

    this.loaded.delete(pluginId);
    this.options.mcp.unregisterToolsByPlugin(pluginId);

    try {
      await record.instance.onUnload();
    } catch (error) {
      // Isolated: a failing teardown must not propagate.
      this.options.logger.record({
        filePath: `plugin://${pluginId}`,
        lineRange: [0, 0],
        author: 'SYSTEM',
        action: 'plugin_unload_error',
        delta: { before: '', after: (error as Error).message },
        metadata: { pluginId },
      });
    }

    this.options.logger.record({
      filePath: `plugin://${pluginId}`,
      lineRange: [0, 0],
      author: 'SYSTEM',
      action: 'plugin_unloaded',
      delta: { before: record.manifest.version, after: '' },
      metadata: { pluginId },
    });

    return true;
  }

  /** Unload every plugin. Errors are swallowed and logged. */
  public async unloadAll(): Promise<void> {
    for (const pluginId of [...this.loaded.keys()]) {
      await this.unload(pluginId);
    }
  }

  /** Currently loaded plugins, ordered by load time. */
  public getLoaded(): LoadedPlugin[] {
    return [...this.loaded.values()].sort((a, b) => a.loadedAt - b.loadedAt);
  }

  /** Whether a plugin id is currently loaded. */
  public isLoaded(pluginId: string): boolean {
    return this.loaded.has(pluginId);
  }
}
