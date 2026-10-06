import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PathTraversalError,
  resolveWorkspacePath,
  toWorkspaceRelative,
  tryResolveWorkspacePath,
} from './pathGuard.ts';

const ROOT = resolve('/tmp/nexus-test-workspace');

describe('resolveWorkspacePath', () => {
  it('resolves a relative path inside the root', () => {
    expect(resolveWorkspacePath(ROOT, 'src/main.ts')).toBe(join(ROOT, 'src', 'main.ts'));
  });

  it('accepts an absolute path that is already inside the root', () => {
    const absolute = join(ROOT, 'src', 'main.ts');
    expect(resolveWorkspacePath(ROOT, absolute)).toBe(absolute);
  });

  it('resolves "." to the root itself', () => {
    expect(resolveWorkspacePath(ROOT, '.')).toBe(ROOT);
  });

  it('does not mistake a file named "..foo" for a traversal', () => {
    expect(resolveWorkspacePath(ROOT, '..foo')).toBe(join(ROOT, '..foo'));
  });

  it.each(['../secret.txt', 'src/../../secret.txt', '../../etc/passwd', 'a/b/../../../x'])(
    'rejects the traversal attempt %s',
    (candidate) => {
      expect(() => resolveWorkspacePath(ROOT, candidate)).toThrow(PathTraversalError);
    },
  );

  it('rejects an absolute path outside the root', () => {
    const outside = join(ROOT, '..', 'outside.txt');
    expect(() => resolveWorkspacePath(ROOT, outside)).toThrow(PathTraversalError);
  });

  it('rejects NUL bytes', () => {
    expect(() => resolveWorkspacePath(ROOT, 'src/main.ts\u0000.png')).toThrow(PathTraversalError);
  });

  it('rejects empty and whitespace-only paths', () => {
    expect(() => resolveWorkspacePath(ROOT, '')).toThrow(PathTraversalError);
    expect(() => resolveWorkspacePath(ROOT, '   ')).toThrow(PathTraversalError);
  });

  it('exposes the attempted path and root on the error', () => {
    try {
      resolveWorkspacePath(ROOT, '../escape');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PathTraversalError);
      const traversal = error as PathTraversalError;
      expect(traversal.attemptedPath).toBe('../escape');
      expect(traversal.workspaceRoot).toBe(ROOT);
      expect(traversal.name).toBe('PathTraversalError');
    }
  });
});

describe('tryResolveWorkspacePath', () => {
  it('returns the resolved path when contained', () => {
    expect(tryResolveWorkspacePath(ROOT, 'a.ts')).toBe(join(ROOT, 'a.ts'));
  });

  it('returns null instead of throwing', () => {
    expect(tryResolveWorkspacePath(ROOT, '../a.ts')).toBeNull();
  });
});

describe('toWorkspaceRelative', () => {
  it('returns a POSIX-style relative path', () => {
    expect(toWorkspaceRelative(ROOT, join(ROOT, 'src', 'deep', 'file.ts'))).toBe('src/deep/file.ts');
  });
});
