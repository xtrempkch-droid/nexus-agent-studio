/**
 * Orchestrates language servers for the workspace.
 *
 * A single server serves one language, is started lazily on first use, and lives
 * until it is reconfigured or the core shuts down. `refresh` is the interesting
 * operation: it opens (or updates) a file in the right server and **waits** for
 * that file's diagnostics to arrive — the wait is what turns the server's
 * asynchronous push into something a tool call can answer with.
 *
 * The transport factory is injectable, so the whole orchestration is testable
 * against a fake server without spawning a process.
 *
 * @module common/lsp/languageServerManager
 */

import { readFile } from 'node:fs/promises';
import type { InlineHintManager } from '../debug/hints.ts';
import { resolveWorkspacePath, toWorkspaceRelative } from '../security/pathGuard.ts';
import { LanguageService, defaultLanguageId } from './languageService.ts';
import type { LspTransport } from './lspClient.ts';
import { createStdioTransport } from './stdioTransport.ts';

/** Declarative description of a language server the core may run. */
export interface LanguageServerConfig {
  /** Stable id, e.g. `typescript`. Also tags the hints the server produces. */
  readonly id: string;
  /** LSP language ids this server serves, e.g. `['typescript', 'typescriptreact']`. */
  readonly languages: readonly string[];
  /** Executable to launch. */
  readonly command: string;
  readonly args?: readonly string[];
  /** Extra environment for the child process. */
  readonly env?: Readonly<Record<string, string>>;
  /** Sent as `initializationOptions` during the handshake. */
  readonly initializationOptions?: unknown;
}

/** A configured server and whether it is currently running. */
export interface LanguageServerStatus {
  readonly id: string;
  readonly languages: readonly string[];
  readonly command: string;
  readonly args: readonly string[];
  readonly running: boolean;
}

/** Builds the transport for a server config. Injectable for tests. */
export type TransportFactory = (
  config: LanguageServerConfig,
  workspaceRoot: string,
) => LspTransport;

/** Options for {@link LanguageServerManager}. */
export interface LanguageServerManagerOptions {
  /** Absolute workspace root. */
  readonly workspaceRoot: string;
  /** Hint store the servers write diagnostics into. */
  readonly hints: InlineHintManager;
  /** Servers available from the start. */
  readonly configs?: readonly LanguageServerConfig[];
  /** Transport factory; defaults to a real stdio child process. */
  readonly transportFactory?: TransportFactory;
  /** Maps a file path to an LSP language id. Defaults to an extension map. */
  readonly languageIdForPath?: (path: string) => string;
  /** Default wait budget for {@link LanguageServerManager.refresh}. */
  readonly defaultWaitMs?: number;
}

/** Default time to wait for a server to publish diagnostics. */
const DEFAULT_WAIT_MS = 2000;

/**
 * Owns the language servers and coordinates document synchronisation.
 */
export class LanguageServerManager {
  private readonly workspaceRoot: string;
  private readonly hints: InlineHintManager;
  private readonly transportFactory: TransportFactory;
  private readonly languageIdForPath: (path: string) => string;
  private readonly defaultWaitMs: number;

  private readonly configs = new Map<string, LanguageServerConfig>();
  private readonly services = new Map<string, LanguageService>();
  private readonly starting = new Map<string, Promise<LanguageService>>();
  /** Files already opened in a server, so the next refresh sends `didChange`. */
  private readonly opened = new Set<string>();
  private readonly waiters = new Map<string, Set<() => void>>();

  public constructor(options: LanguageServerManagerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.hints = options.hints;
    this.transportFactory =
      options.transportFactory ??
      ((config, cwd) =>
        createStdioTransport({
          command: config.command,
          args: config.args ?? [],
          cwd,
          ...(config.env === undefined ? {} : { env: config.env }),
        }));
    this.languageIdForPath = options.languageIdForPath ?? defaultLanguageId;
    this.defaultWaitMs = options.defaultWaitMs ?? DEFAULT_WAIT_MS;

    for (const config of options.configs ?? []) {
      this.configs.set(config.id, config);
    }
  }

  /**
   * Register or replace a server. A running instance for the same id is stopped;
   * the next refresh starts it again with the new configuration.
   */
  public configureServer(config: LanguageServerConfig): void {
    const running = this.services.get(config.id);
    if (running !== undefined) {
      running.dispose();
      this.services.delete(config.id);
    }
    this.starting.delete(config.id);
    this.configs.set(config.id, config);
  }

  /** Every configured server, with its running state. */
  public listServers(): LanguageServerStatus[] {
    return [...this.configs.values()]
      .map((config) => ({
        id: config.id,
        languages: config.languages,
        command: config.command,
        args: config.args ?? [],
        running: this.services.has(config.id),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /**
   * Open or update a file and wait for its language server to publish
   * diagnostics for it.
   *
   * @param path - Workspace-relative (or absolute-within-workspace) file path.
   * @param waitMs - Maximum time to wait for a publish. Defaults to 2000 ms.
   * @returns The workspace-relative path and the server id, or `null` when no
   * configured server serves the file's language.
   * @throws {@link PathTraversalError} when the path escapes the workspace.
   */
  public async refresh(
    path: string,
    waitMs?: number,
  ): Promise<{ filePath: string; server: string | null }> {
    const absolute = resolveWorkspacePath(this.workspaceRoot, path);
    const filePath = toWorkspaceRelative(this.workspaceRoot, absolute);

    const config = this.configFor(filePath);
    if (config === null) {
      return { filePath, server: null };
    }

    const service = await this.ensureService(config);
    const content = await readFile(absolute, 'utf8');

    const waited = this.waitFor(filePath, waitMs ?? this.defaultWaitMs);
    if (this.opened.has(filePath)) {
      service.changeDocument(filePath, content);
    } else {
      service.openDocument(filePath, content);
      this.opened.add(filePath);
    }
    await waited;

    return { filePath, server: config.id };
  }

  /** Stop every server and forget all state. */
  public dispose(): void {
    for (const service of this.services.values()) {
      service.dispose();
    }
    this.services.clear();
    this.starting.clear();
    this.opened.clear();
    this.waiters.clear();
  }

  private configFor(filePath: string): LanguageServerConfig | null {
    const languageId = this.languageIdForPath(filePath);
    for (const config of this.configs.values()) {
      if (config.languages.includes(languageId)) {
        return config;
      }
    }
    return null;
  }

  private ensureService(config: LanguageServerConfig): Promise<LanguageService> {
    const existing = this.starting.get(config.id);
    if (existing !== undefined) {
      return existing;
    }

    const promise = this.startService(config).catch((error: unknown) => {
      // A failed start must not poison the id forever; a later refresh retries.
      this.starting.delete(config.id);
      throw error;
    });
    this.starting.set(config.id, promise);
    return promise;
  }

  private async startService(config: LanguageServerConfig): Promise<LanguageService> {
    const service = new LanguageService({
      transport: this.transportFactory(config, this.workspaceRoot),
      workspaceRoot: this.workspaceRoot,
      hints: this.hints,
      source: `lsp:${config.id}`,
      languageIdForPath: this.languageIdForPath,
      onDiagnostics: (filePath) => this.notifyDiagnostics(filePath),
    });

    await service.start(
      config.initializationOptions === undefined
        ? {}
        : { initializationOptions: config.initializationOptions },
    );

    this.services.set(config.id, service);
    return service;
  }

  /** Wake every waiter for a file once its diagnostics arrive (or are empty). */
  private notifyDiagnostics(filePath: string): void {
    const set = this.waiters.get(filePath);
    if (set === undefined) {
      return;
    }
    for (const resolve of [...set]) {
      resolve();
    }
  }

  private waitFor(filePath: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const set = this.waiters.get(filePath) ?? new Set<() => void>();
      const timer = setTimeout(done, timeoutMs);
      timer.unref?.();

      function done(): void {
        clearTimeout(timer);
        set.delete(done);
        resolve();
      }

      set.add(done);
      this.waiters.set(filePath, set);
    });
  }
}
