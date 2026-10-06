/**
 * Event-sourced execution logger.
 *
 * Every change the editor, the user or the AI performs is appended as an
 * immutable {@link LogEntry}. Nothing is ever mutated or deleted: the log is the
 * source of truth, and subscribers (terminal, diff inspector, telemetry) read
 * from it. Container executions are recorded alongside code changes so a failing
 * build can be correlated with the exact edit that caused it.
 *
 * @module common/debug/logger
 */

import { randomUUID } from 'node:crypto';
import { InlineHintManager, type HintSeverity, type InlineHint } from './hints.ts';

/** Who originated a change. */
export type LogAuthor = 'USER' | 'AI' | 'SYSTEM';

/** Inclusive 1-based line range. */
export type LineRange = readonly [start: number, end: number];

/**
 * A single, immutable change event.
 */
export interface LogEntry {
  readonly id: string;
  /** Unix epoch milliseconds. */
  readonly timestamp: number;
  /** Workspace-relative path of the affected file. */
  readonly filePath: string;
  /** Affected line range. Use `[0, 0]` for whole-file or non-textual events. */
  readonly lineRange: LineRange;
  readonly author: LogAuthor;
  /** Verb describing the change, e.g. `write_file`, `apply_patch`. */
  readonly action: string;
  /** Textual before/after snapshot of the affected region. */
  readonly delta: { readonly before: string; readonly after: string };
  /** Arbitrary structured context (tool name, model, exit code, ...). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Record of one Docker sandbox execution.
 */
export interface ContainerRunRecord {
  readonly containerId: string;
  readonly image: string;
  readonly command: string;
  readonly exitCode: number;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly startedAt: number;
}

/** Discriminated union of everything the logger can emit. */
export type LoggerEvent =
  | { readonly type: 'entry'; readonly entry: LogEntry }
  | { readonly type: 'container'; readonly record: ContainerRunRecord }
  | { readonly type: 'hint:add'; readonly hint: InlineHint }
  | { readonly type: 'hint:remove'; readonly hintId: string };

/** Observer for {@link ExecutionLogger.subscribe}. */
export type LoggerListener = (event: LoggerEvent) => void;

/** Input accepted by {@link ExecutionLogger.record}. */
export type LogEntryInput = Omit<LogEntry, 'id' | 'timestamp'> & {
  readonly id?: string;
  readonly timestamp?: number;
};

/**
 * Append-only change log with an embedded {@link InlineHintManager}.
 */
export class ExecutionLogger {
  private readonly entries: LogEntry[] = [];
  private readonly containerRuns: ContainerRunRecord[] = [];
  private readonly listeners = new Set<LoggerListener>();

  /** Hint store, shared with the compiler error parser and the editor UI. */
  public readonly hints = new InlineHintManager();

  /** @param workspaceRoot - Root used to keep paths relative in the UI. */
  public constructor(public readonly workspaceRoot: string) {
    this.hints.subscribe((all) => {
      // Re-emit granular hint events is unnecessary; consumers can read `hints`.
      void all;
    });
  }

  /**
   * Append a change event.
   *
   * @returns The stored, frozen entry.
   */
  public record(input: LogEntryInput): LogEntry {
    const entry: LogEntry = Object.freeze({
      id: input.id ?? randomUUID(),
      timestamp: input.timestamp ?? Date.now(),
      filePath: input.filePath,
      lineRange: Object.freeze([input.lineRange[0], input.lineRange[1]]) as LineRange,
      author: input.author,
      action: input.action,
      delta: Object.freeze({ before: input.delta.before, after: input.delta.after }),
      ...(input.metadata === undefined ? {} : { metadata: Object.freeze({ ...input.metadata }) }),
    });

    this.entries.push(entry);
    this.emit({ type: 'entry', entry });
    return entry;
  }

  /**
   * Append a container execution record and mirror its identity into the log.
   */
  public recordContainerRun(record: ContainerRunRecord): ContainerRunRecord {
    const stored: ContainerRunRecord = Object.freeze({ ...record });
    this.containerRuns.push(stored);
    this.emit({ type: 'container', record: stored });
    return stored;
  }

  /**
   * Convenience wrapper around {@link InlineHintManager.add} that also emits an
   * event so the UI updates immediately.
   */
  public addInlineHint(hint: {
    filePath: string;
    line: number;
    message: string;
    severity: HintSeverity;
    codeFix?: string;
    source?: string;
  }): InlineHint {
    const stored = this.hints.add(hint);
    this.emit({ type: 'hint:add', hint: stored });
    return stored;
  }

  /** Remove an inline hint and emit the corresponding event. */
  public removeInlineHint(id: string): boolean {
    const removed = this.hints.remove(id);
    if (removed) {
      this.emit({ type: 'hint:remove', hintId: id });
    }
    return removed;
  }

  /** All change events, oldest first. */
  public getEntries(): readonly LogEntry[] {
    return this.entries;
  }

  /** All container runs, oldest first. */
  public getContainerRuns(): readonly ContainerRunRecord[] {
    return this.containerRuns;
  }

  /**
   * Subscribe to log events.
   *
   * @returns An unsubscribe function.
   */
  public subscribe(listener: LoggerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Serializable snapshot for persistence or telemetry export.
   */
  public toJSON(): {
    workspaceRoot: string;
    entries: readonly LogEntry[];
    containerRuns: readonly ContainerRunRecord[];
    hints: readonly InlineHint[];
  } {
    return {
      workspaceRoot: this.workspaceRoot,
      entries: this.entries,
      containerRuns: this.containerRuns,
      hints: this.hints.all(),
    };
  }

  private emit(event: LoggerEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
