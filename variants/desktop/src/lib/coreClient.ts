/**
 * Typed access to the tools the core exposes.
 *
 * Every tool answers through the same MCP envelope: a result either carries
 * `content[0].text` and nothing else, or carries it together with
 * `isError: true`. The text of a *successful* file tool is JSON; the text of a
 * failure is a human-readable sentence. This module is the single place that
 * knows both facts, so no component has to.
 *
 * `isError` is deliberately not turned into a rejection for every tool: the
 * sandbox reports a timed-out container that way *while still carrying the
 * output it collected*, which is exactly the moment the output matters most.
 * The strict helpers throw; {@link runInSandbox} reads what it was given.
 *
 * @module variants/desktop/src/lib/coreClient
 */

import { callCoreTool } from './shell.ts';
import type { CursorPosition, EditorContext, InlineHint, TextSelection } from './coreTypes.ts';

/** One block of a tool result, as the protocol spells it. */
interface TextBlock {
  readonly type?: string;
  readonly text?: string;
}

/** The subset of a tool result this module consumes. */
interface ToolResult {
  readonly content?: readonly TextBlock[];
  readonly isError?: boolean;
}

/** Parse JSON, treating "not JSON" as an ordinary outcome rather than a throw. */
function parsePayload(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Read a field that is expected to be a string, whatever the payload actually held. */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Read a field that is expected to be a number, whatever the payload actually held. */
function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : -1;
}

/** Call a tool whose success payload is JSON and whose failure payload is prose. */
async function callJsonTool<T>(tool: string, args: object): Promise<T> {
  const result = await callCoreTool<ToolResult>(tool, args);
  const text = result.content?.[0]?.text ?? '';

  if (result.isError === true) {
    throw new Error(text === '' ? `A ferramenta "${tool}" falhou sem mensagem.` : text);
  }

  const payload = parsePayload(text);
  if (payload === null) {
    throw new Error(`Resposta inesperada de "${tool}": ${text.slice(0, 200)}`);
  }

  // The payload was validated as an object; the declared shape is the contract
  // the core's own schema enforces, so this boundary cast is the whole point of
  // the function.
  return payload as unknown as T;
}

/** A file or directory in the workspace, as `list_directory` reports it. */
export interface DirectoryEntry {
  readonly path: string;
  readonly type: 'file' | 'directory';
  readonly size: number;
}

/** The `list_directory` result. */
export interface DirectoryListing {
  readonly root: string;
  readonly count: number;
  readonly truncated: boolean;
  readonly entries: readonly DirectoryEntry[];
}

/** The `read_file` result. */
export interface FileContents {
  readonly path: string;
  readonly bytes: number;
  readonly modifiedAt: number;
  readonly content: string;
}

/** The `write_file` result. */
export interface WriteOutcome {
  readonly path: string;
  readonly created: boolean;
  readonly bytesWritten: number;
}

/** List the workspace tree, up to `maxDepth` levels deep. */
export function listDirectory(path = '.', maxDepth = 4): Promise<DirectoryListing> {
  return callJsonTool<DirectoryListing>('list_directory', { path, maxDepth });
}

/** Read one workspace file as UTF-8 text. */
export function readFile(path: string): Promise<FileContents> {
  return callJsonTool<FileContents>('read_file', { path });
}

/** Create or overwrite one workspace file. */
export function writeFile(path: string, content: string): Promise<WriteOutcome> {
  return callJsonTool<WriteOutcome>('write_file', { path, content });
}

/** The `list_models` result. */
export interface ModelListResult {
  readonly kind: 'ollama' | 'openai';
  readonly baseUrl: string;
  readonly count: number;
  readonly models: readonly string[];
}

/** List the model names a provider exposes. */
export function listModels(kind: 'ollama' | 'openai', baseUrl: string): Promise<ModelListResult> {
  return callJsonTool<ModelListResult>('list_models', { kind, baseUrl });
}

/** The `ask_agent` result. */
export interface AgentTurnResult {
  readonly status: 'done' | 'needs_approval';
  readonly answer: string;
  readonly toolCalls: readonly string[];
  readonly steps: number;
  /** Populated when `status` is `needs_approval`; fed back verbatim to resume. */
  readonly tool?: string;
  readonly arguments?: unknown;
  readonly history?: readonly unknown[];
  readonly assistantJson?: string;
}

/** Inputs for `ask_agent`, including the resume state of a paused turn. */
export interface AskAgentInput {
  readonly prompt?: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly kind: 'ollama' | 'openai';
  readonly mode?: 'autonomous' | 'assisted';
  readonly history?: readonly unknown[];
  readonly assistantJson?: string;
  readonly pendingTool?: string;
  readonly pendingArguments?: unknown;
  readonly decision?: 'approve' | 'reject';
}

/** Ask the agent to perform a task, using the selected provider and model. */
export function askAgent(input: AskAgentInput): Promise<AgentTurnResult> {
  return callJsonTool<AgentTurnResult>('ask_agent', input);
}

/** What a sandboxed command produced. */
export interface SandboxRun {
  readonly containerId: string;
  /** Exit code, or `-1` when the container never reported one. */
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * Run a shell command in the core's Docker sandbox.
 *
 * Unlike the file tools this does **not** throw on `isError`, because a timed-out
 * run still reports the output it collected. A payload that cannot be read at
 * all — typically "docker is not installed" — does throw, since there is nothing
 * to show.
 */
export async function runInSandbox(command: string): Promise<SandboxRun> {
  const result = await callCoreTool<ToolResult>('run_terminal_command', { command });
  const text = result.content?.[0]?.text ?? '';
  const payload = parsePayload(text);

  if (payload === null) {
    throw new Error(
      text === '' ? 'O sandbox não respondeu nada.' : text,
    );
  }

  return {
    containerId: asString(payload['containerId']),
    exitCode: asNumber(payload['exitCode']),
    stdout: asString(payload['stdout']),
    stderr: asString(payload['stderr']),
    timedOut: payload['timedOut'] === true,
  };
}

/** A language server as the core reports it. */
export interface LanguageServerStatus {
  readonly id: string;
  readonly languages: readonly string[];
  readonly command: string;
  readonly args: readonly string[];
  /** Whether the server process is currently running. */
  readonly running: boolean;
}

/** Inputs for `configure_language_server`. */
export interface ConfigureLanguageServerInput {
  readonly id: string;
  readonly languages: readonly string[];
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** Register or replace a language server in the core. */
export function configureLanguageServer(
  input: ConfigureLanguageServerInput,
): Promise<{ configured: LanguageServerStatus[] }> {
  return callJsonTool<{ configured: LanguageServerStatus[] }>('configure_language_server', input);
}

/** List the language servers configured in the core. */
export function listLanguageServers(): Promise<{ servers: LanguageServerStatus[] }> {
  return callJsonTool<{ servers: LanguageServerStatus[] }>('list_language_servers', {});
}

/** The `get_diagnostics` result. */
export interface DiagnosticsResult {
  /** The file the result is about, or `null` when every file was returned. */
  readonly path: string | null;
  /** Language server that answered, or `null` when none serves the file. */
  readonly server: string | null;
  readonly count: number;
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  readonly diagnostics: readonly InlineHint[];
}

/**
 * Ask the core for diagnostics.
 *
 * With `path`, the core first refreshes that file in its language server (when
 * one is configured) and returns only its diagnostics; without `path` it returns
 * every known diagnostic. Compiler diagnostics produced by a sandboxed run are in
 * the same store, so one call covers both sources.
 */
export function getDiagnostics(
  input: { path?: string; waitMs?: number; refresh?: boolean } = {},
): Promise<DiagnosticsResult> {
  return callJsonTool<DiagnosticsResult>('get_diagnostics', input);
}

/** The editor state the UI reports, as `set_editor_context` takes it. */
export interface EditorContextReport {
  /** Workspace-relative path of the focused file, or `null` when none is open. */
  readonly activeFile: string | null;
  readonly cursor?: CursorPosition;
  readonly selection?: TextSelection | null;
  readonly openFiles?: readonly string[];
  readonly dirty?: boolean;
}

/**
 * Tell the core what the editor is showing.
 *
 * This is the write half of `get_editor_context`: without it the agent would see
 * the empty context and have to ask the user which file and which lines they
 * mean. Fields left out keep their previous value in the core.
 */
export function setEditorContext(report: EditorContextReport): Promise<EditorContext> {
  return callJsonTool<EditorContext>('set_editor_context', report);
}
