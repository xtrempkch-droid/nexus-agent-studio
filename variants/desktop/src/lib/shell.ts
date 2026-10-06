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

/** The global Tauri injects when `app.withGlobalTauri` is enabled. */
interface TauriGlobal {
  readonly core?: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
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
 * Invoke a core tool through the shell.
 *
 * The resolved value is the tool result exactly as the core produced it —
 * including `isError: true` for a tool that failed, which is an ordinary
 * outcome to inspect rather than an exception to catch. Only a broken exchange
 * rejects.
 */
export function callCoreTool<T = unknown>(
  tool: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return invokeShell<T>('call_core_tool', { tool, arguments: args });
}
