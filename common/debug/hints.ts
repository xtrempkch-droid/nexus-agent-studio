/**
 * Inline diagnostics ("hints") attached to a file and line.
 *
 * Hints are produced by the compiler error parser and rendered by the editor UI.
 * The manager is a small observable store: it never mutates a hint in place and
 * notifies subscribers after every change.
 *
 * @module common/debug/hints
 */

import { randomUUID } from 'node:crypto';

/** Severity levels surfaced by the editor gutter. */
export type HintSeverity = 'error' | 'warning' | 'info';

/**
 * A diagnostic attached to a precise location in a file.
 */
export interface InlineHint {
  /** Stable unique id. */
  readonly id: string;
  /** Workspace-relative path of the offending file. */
  readonly filePath: string;
  /** 1-based line number. */
  readonly line: number;
  /** Human-readable diagnostic text. */
  readonly message: string;
  /** Severity, drives colour in the UI. */
  readonly severity: HintSeverity;
  /** Optional suggested source replacement. */
  readonly codeFix?: string;
  /**
   * Origin of the hint, e.g. `docker:gcc:latest`. Used to clear all diagnostics
   * produced by a previous run before a new one starts.
   */
  readonly source?: string;
}

/** Observer invoked whenever the hint set changes. */
export type HintListener = (hints: readonly InlineHint[]) => void;

/**
 * Observable, per-file store of {@link InlineHint} instances.
 */
export class InlineHintManager {
  private readonly hints = new Map<string, InlineHint>();
  private readonly listeners = new Set<HintListener>();

  /**
   * Inject a hint. When `id` is omitted a UUID is generated.
   *
   * @returns The stored, frozen hint.
   */
  public add(hint: Omit<InlineHint, 'id'> & { id?: string }): InlineHint {
    const stored: InlineHint = Object.freeze({
      id: hint.id ?? randomUUID(),
      filePath: hint.filePath,
      line: hint.line,
      message: hint.message,
      severity: hint.severity,
      ...(hint.codeFix === undefined ? {} : { codeFix: hint.codeFix }),
      ...(hint.source === undefined ? {} : { source: hint.source }),
    });

    this.hints.set(stored.id, stored);
    this.emit();
    return stored;
  }

  /**
   * Remove a single hint by id.
   *
   * @returns `true` when a hint was removed.
   */
  public remove(id: string): boolean {
    const removed = this.hints.delete(id);
    if (removed) {
      this.emit();
    }
    return removed;
  }

  /**
   * Remove every hint attached to a file.
   *
   * @returns The number of removed hints.
   */
  public clearFile(filePath: string): number {
    let removed = 0;
    for (const [id, hint] of this.hints) {
      if (hint.filePath === filePath) {
        this.hints.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.emit();
    }
    return removed;
  }

  /**
   * Remove every hint produced by a given source (e.g. the previous container run).
   *
   * @returns The number of removed hints.
   */
  public clearSource(source: string): number {
    let removed = 0;
    for (const [id, hint] of this.hints) {
      if (hint.source === source) {
        this.hints.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.emit();
    }
    return removed;
  }

  /** Remove every hint. */
  public clear(): void {
    if (this.hints.size === 0) {
      return;
    }
    this.hints.clear();
    this.emit();
  }

  /** Hints for one file, ordered by line. */
  public getForFile(filePath: string): InlineHint[] {
    return [...this.hints.values()]
      .filter((hint) => hint.filePath === filePath)
      .sort((a, b) => a.line - b.line);
  }

  /** All hints, ordered by file then line. */
  public all(): InlineHint[] {
    return [...this.hints.values()].sort(
      (a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line,
    );
  }

  /**
   * Subscribe to hint-set changes.
   *
   * @returns An unsubscribe function.
   */
  public subscribe(listener: HintListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.all();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
