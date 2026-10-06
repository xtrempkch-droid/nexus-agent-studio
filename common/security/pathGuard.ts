/**
 * Workspace path confinement.
 *
 * Every file-system tool in this project resolves user- or model-supplied paths
 * through {@link resolveWorkspacePath}, which guarantees the result is inside
 * the workspace root. This is the single choke point that defends against path
 * traversal (`../../etc/passwd`), absolute-path escapes and NUL-byte injection.
 *
 * @module common/security/pathGuard
 */

import { isAbsolute, normalize, relative, resolve } from 'node:path';

/**
 * Thrown when a candidate path would escape the configured workspace root.
 */
export class PathTraversalError extends Error {
  public override readonly name = 'PathTraversalError';

  /**
   * @param attemptedPath - The raw, untrusted path supplied by the caller.
   * @param workspaceRoot - The workspace root the path was resolved against.
   */
  public constructor(
    public readonly attemptedPath: string,
    public readonly workspaceRoot: string,
  ) {
    super(`Path "${attemptedPath}" escapes the workspace root "${workspaceRoot}".`);
  }
}

/**
 * Resolve `candidate` against `workspaceRoot` and assert containment.
 *
 * Relative candidates are joined to the root; absolute candidates are accepted
 * only when they already point inside the root. The comparison is performed on
 * normalized, platform-correct paths.
 *
 * @param workspaceRoot - Absolute path to the workspace root.
 * @param candidate - Untrusted, possibly relative, path.
 * @returns The absolute, normalized path inside the workspace.
 * @throws {@link PathTraversalError} when the path escapes the workspace.
 */
export function resolveWorkspacePath(workspaceRoot: string, candidate: string): string {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new PathTraversalError(String(candidate), workspaceRoot);
  }

  // NUL bytes can truncate paths in native layers.
  if (candidate.includes('\u0000')) {
    throw new PathTraversalError(candidate, workspaceRoot);
  }

  const root = resolve(workspaceRoot);
  const absolute = isAbsolute(candidate) ? normalize(candidate) : resolve(root, candidate);

  const rel = relative(root, absolute);
  if (rel === '') {
    return root;
  }

  // Split so a legitimate file named "..foo" is not misclassified.
  const firstSegment = rel.split(/[\\/]/u)[0];
  if (firstSegment === '..' || isAbsolute(rel)) {
    throw new PathTraversalError(candidate, workspaceRoot);
  }

  return absolute;
}

/**
 * Non-throwing variant of {@link resolveWorkspacePath}.
 *
 * @returns The resolved path, or `null` when the candidate escapes the root.
 */
export function tryResolveWorkspacePath(
  workspaceRoot: string,
  candidate: string,
): string | null {
  try {
    return resolveWorkspacePath(workspaceRoot, candidate);
  } catch {
    return null;
  }
}

/**
 * Convert an absolute path inside the workspace back to a workspace-relative,
 * POSIX-style path (stable across platforms, suitable for logs and UI).
 */
export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  const rel = relative(resolve(workspaceRoot), absolutePath);
  return rel.split(/[\\/]/u).join('/');
}
