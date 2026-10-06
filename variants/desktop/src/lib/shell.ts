/**
 * Typed bridge to the desktop shell.
 *
 * The shell owns the core process and exposes it through a few commands
 * (`core_handshake`, `call_core_tool`). This module is the **only** place that
 * knows how the webview reaches them, which keeps the transport swappable.
 *
 * It currently uses the global Tauri injects when `app.withGlobalTauri` is
 * enabled. Moving to the `@tauri-apps/api` package later would change this file
 * and nothing else — and that matters here, because adding a dependency
 * invalidates `package-lock.json` and breaks the `npm ci` step the CI is built
 * around, so it is not a change to make casually from inside the browser code.
 *
 * Outside the shell — `npm run dev:desktop` in a plain browser — nothing is
 * injected, every call rejects, and the UI can fall back to its simulation
 * honestly instead of pretending to be connected.
 *
 * @module variants/desktop/src/lib/shell
 */

import type { AgentProgressEvent } from './coreTypes.ts';

/** A Tauri event as delivered by the injected global API. */
interface TauriEvent<T> {
  readonly event: string;
  readonly id?: number;
  readonly payload: T;
}

/** The global Tauri injects when `app.withGlobalTauri` is enabled. */
interface TauriGlobal {
  readonly core?: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
  readonly event?: {
    listen<T>(event: string, handler: (event: TauriEvent<T>) => void): Promise<() => void>;
  };
}

declare global {
  interface Window {
    readonly __TAURI__?: TauriGlobal;
  }
}

/** Whether this code is running inside the desktop shell rather than a browser. */
export function isShellAvailable(): boolean {
  return typeof window !== 'undefined' && window.__TAURI__?.core !== undefined;
}

/** Invoke a shell command. Rejects when there is no shell to talk to. */
export function invokeShell<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const core = window.__TAURI__?.core;
  if (core === undefined) {
    return Promise.reject(new Error('the desktop shell is not available in this context'));
  }
  return core.invoke<T>(command, args);
}

/**
 * Ask the shell to describe the core it holds: identity, protocol, and tools.
 *
 * The shell starts and handshakes the core on first use, so the first call is
 * the slow one and later calls are cheap.
 */
export function describeCore(): Promise<string> {
  return invokeShell<string>('core_handshake');
}

/**
 * The directory the core is actually editing.
 *
 * Worth asking for rather than assuming: the header used to display a hardcoded
 * label while the editor looked somewhere else, which makes a wrong workspace
 * indistinguishable from an empty one.
 */
export function workspaceInfo(): Promise<string> {
  return invokeShell<string>('workspace_info');
}

/**
 * Invoke a core tool through the shell.
 *
 * The resolved value is the tool result exactly as the core produced it —
 * including `isError: true` for a tool that failed, which is an ordinary
 * outcome to inspect rather than an exception to catch. Only a broken exchange
 * rejects.
 */
export function callCoreTool<T = unknown>(tool: string, args: object = {}): Promise<T> {
  return invokeShell<T>('call_core_tool', { tool, arguments: args });
}

/**
 * Open the native folder picker and switch the editor to the chosen project.
 *
 * Resolves to the new (canonicalised) workspace path, or `null` when the user
 * cancelled the dialog. The shell opens the dialog and switches the core itself,
 * so the webview never invents a filesystem path.
 */
export function pickWorkspace(): Promise<string | null> {
  return invokeShell<string | null>('pick_workspace');
}

/**
 * Point the editor at an explicit workspace directory (the text-input fallback
 * to the native picker). Resolves to the canonicalised path, or rejects when the
 * path is not a real directory.
 */
export function setWorkspace(path: string): Promise<string> {
  return invokeShell<string>('set_workspace', { path });
}

/**
 * Open the native file picker and open the chosen file.
 *
 * The editor edits a project directory, so the shell switches the workspace to
 * the file's parent and returns `[workspace, file]` (the file is relative to
 * that workspace). Resolves to `null` when the dialog was cancelled.
 */
export function pickFile(): Promise<[string, string] | null> {
  return invokeShell<[string, string] | null>('pick_file');
}

/**
 * Subscribe to agent progress events streamed from the core.
 *
 * The core emits `notifications/agent/stream` while `ask_agent` runs; the shell
 * forwards each as an `agent-stream` Tauri event whose payload is an
 * {@link AgentProgressEvent}. The returned promise resolves to an unsubscribe
 * function. Outside the shell it rejects, which callers treat as "no stream".
 */
export function onAgentStream(
  handler: (event: AgentProgressEvent) => void,
): Promise<() => void> {
  const eventApi = window.__TAURI__?.event;
  if (eventApi === undefined) {
    return Promise.reject(
      new Error('the desktop shell event API is not available in this context'),
    );
  }
  return eventApi.listen<AgentProgressEvent>('agent-stream', (event) => handler(event.payload));
}
