import { describe, expect, it, vi } from 'vitest';
import { ExecutionLogger, type LoggerEvent } from './logger.ts';

function createLogger(): ExecutionLogger {
  return new ExecutionLogger('/workspace');
}

describe('ExecutionLogger', () => {
  it('records frozen entries with a generated id and timestamp', () => {
    const logger = createLogger();
    const entry = logger.record({
      filePath: 'src/main.ts',
      lineRange: [1, 3],
      author: 'AI',
      action: 'write_file',
      delta: { before: 'a', after: 'b' },
    });

    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(logger.getEntries()).toHaveLength(1);
  });

  it('preserves a caller-supplied id and timestamp', () => {
    const logger = createLogger();
    const entry = logger.record({
      id: 'fixed-id',
      timestamp: 42,
      filePath: 'a.ts',
      lineRange: [0, 0],
      author: 'USER',
      action: 'edit',
      delta: { before: '', after: '' },
    });

    expect(entry.id).toBe('fixed-id');
    expect(entry.timestamp).toBe(42);
  });

  it('appends without mutating previous entries', () => {
    const logger = createLogger();
    const first = logger.record({
      filePath: 'a.ts',
      lineRange: [1, 1],
      author: 'USER',
      action: 'edit',
      delta: { before: 'x', after: 'y' },
    });

    logger.record({
      filePath: 'b.ts',
      lineRange: [2, 2],
      author: 'AI',
      action: 'write_file',
      delta: { before: '', after: 'z' },
    });

    expect(logger.getEntries()).toHaveLength(2);
    expect(logger.getEntries()[0]).toBe(first);
    expect(first.delta.after).toBe('y');
  });

  it('notifies subscribers of every event type', () => {
    const logger = createLogger();
    const events: LoggerEvent[] = [];
    const unsubscribe = logger.subscribe((event) => events.push(event));

    logger.record({
      filePath: 'a.ts',
      lineRange: [1, 1],
      author: 'AI',
      action: 'edit',
      delta: { before: '', after: '' },
    });
    logger.recordContainerRun({
      containerId: 'nexus-1',
      image: 'gcc:latest',
      command: 'make',
      exitCode: 1,
      durationMs: 12,
      stdout: 'out',
      stderr: 'err',
      startedAt: 1,
    });
    logger.addInlineHint({
      filePath: 'a.c',
      line: 4,
      message: 'error: expected ;',
      severity: 'error',
      source: 'docker:gcc:latest',
    });

    unsubscribe();
    logger.record({
      filePath: 'ignored.ts',
      lineRange: [0, 0],
      author: 'SYSTEM',
      action: 'noop',
      delta: { before: '', after: '' },
    });

    expect(events.map((event) => event.type)).toEqual(['entry', 'container', 'hint:add']);
  });

  it('stores container runs in order', () => {
    const logger = createLogger();
    logger.recordContainerRun({
      containerId: 'nexus-a',
      image: 'gcc:latest',
      command: 'make',
      exitCode: 0,
      durationMs: 5,
      stdout: '',
      stderr: '',
      startedAt: 1,
    });

    expect(logger.getContainerRuns()).toHaveLength(1);
    expect(logger.getContainerRuns()[0]?.containerId).toBe('nexus-a');
  });

  it('bridges addInlineHint to the hint store and emits removal', () => {
    const logger = createLogger();
    const spy = vi.fn();
    logger.subscribe(spy);

    const hint = logger.addInlineHint({
      filePath: 'src/main.ts',
      line: 7,
      message: 'TS2322: Type is not assignable',
      severity: 'error',
      source: 'docker:node:22',
    });

    expect(logger.hints.getForFile('src/main.ts')).toHaveLength(1);
    expect(logger.removeInlineHint(hint.id)).toBe(true);
    expect(logger.removeInlineHint(hint.id)).toBe(false);
    expect(spy).toHaveBeenLastCalledWith({ type: 'hint:remove', hintId: hint.id });
  });

  it('exports a serializable snapshot', () => {
    const logger = createLogger();
    logger.record({
      filePath: 'a.ts',
      lineRange: [1, 1],
      author: 'AI',
      action: 'edit',
      delta: { before: '', after: '' },
    });

    const snapshot = logger.toJSON();
    expect(snapshot.workspaceRoot).toBe('/workspace');
    expect(snapshot.entries).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(snapshot))).toBeDefined();
  });
});
