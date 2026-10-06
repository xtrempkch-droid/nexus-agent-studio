/**
 * Built-in file-system tools.
 *
 * All paths are resolved through {@link resolveWorkspacePath}, so a tool call can
 * never read or write outside the workspace root. Writes are atomic: the content
 * is written to a sibling temp file and `rename()`d into place, which makes the
 * update atomic on POSIX and never leaves a half-written file behind.
 *
 * @module common/mcp/tools/fileTools
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import * as z from 'zod/v4';
import { PathTraversalError, resolveWorkspacePath, toWorkspaceRelative } from '../../security/pathGuard.ts';
import type { ExecutionLogger } from '../../debug/logger.ts';
import { errorResult, jsonResult, type ToolRegistration } from '../types.ts';
import { isPathIgnored, parseGitignore, type GitignoreSource } from './gitignore.ts';

/** Dependencies for {@link createFileTools}. */
export interface FileToolsOptions {
  /** Absolute workspace root. */
  readonly workspaceRoot: string;
  /** Logger that records every mutation. */
  readonly logger: ExecutionLogger;
  /** Maximum number of entries returned by `list_directory`. Defaults to 2000. */
  readonly maxDirectoryEntries?: number;
  /**
   * Directory **names** `list_directory` refuses to descend into on a root walk.
   * Defaults to {@link DEFAULT_EXCLUDED_DIRECTORIES}.
   */
  readonly excludedDirectories?: readonly string[];
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Order entries by path, comparing plain code units.
 *
 * Sorting by path rather than grouping directories first is deliberate: the
 * result is a **flat** list of full workspace-relative paths, so grouping by
 * kind would tear the tree apart — every directory ahead of every file, with a
 * directory's own children somewhere else in the list. Ordering by path is what
 * keeps `src` next to `src/main.ts`.
 *
 * A plain comparison rather than `localeCompare`, also deliberately: the locale
 * varies between machines, so ordering by it would make the result — and any
 * test asserting it — depend on where it ran. Case sensitivity is the price,
 * since uppercase sorts before lowercase. Predictable beats natural here.
 */
function compareEntries(
  left: { readonly path: string },
  right: { readonly path: string },
): number {
  if (left.path === right.path) {
    return 0;
  }
  return left.path < right.path ? -1 : 1;
}

/**
 * Directories a workspace walk never descends into, matched by name.
 *
 * Without this the explorer is useless on any real repository: `.git/objects`
 * holds more files than the source does, so a plain walk spends the whole
 * entry budget on object hashes and the tree the user sees is almost entirely
 * noise. The list follows what editors hide by default — version control and
 * dependency trees — rather than trying to be clever about build output.
 *
 * This is a **default, not a ban**: it filters the entries of a walk, not the
 * starting point. `list_directory` on the excluded path itself still works,
 * because asking for a directory by name is an explicit request.
 *
 * The fixed list is complemented, not replaced, by honouring `.gitignore` during
 * the walk (see {@link ./gitignore.ts}): a fixed list cannot know that a project
 * keeps source in `target/`, but the project's own ignore file can.
 */
const DEFAULT_EXCLUDED_DIRECTORIES: readonly string[] = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  '__pycache__',
  '.venv',
  'venv',
  '.mypy_cache',
  '.pytest_cache',
];

function escapeHtmlLike(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '');
}

/**
 * Read and parse the `.gitignore` in a directory, if there is one.
 *
 * @param absoluteDir - Absolute path to the directory.
 * @param baseDir - Workspace-relative path of that directory (`''` for root).
 * @returns The parsed source, or `null` when there is no readable `.gitignore`.
 */
async function loadGitignore(
  absoluteDir: string,
  baseDir: string,
): Promise<GitignoreSource | null> {
  try {
    const content = await readFile(join(absoluteDir, '.gitignore'), 'utf8');
    return { baseDir, patterns: parseGitignore(content) };
  } catch {
    return null;
  }
}

/**
 * Create the `read_file`, `write_file` and `list_directory` tools.
 *
 * @param options - Workspace root and logger.
 * @returns The tool registrations, ready to pass to `InternalMCPServer.registerTool`.
 */
export function createFileTools(options: FileToolsOptions): ToolRegistration[] {
  const { workspaceRoot, logger } = options;
  const maxEntries = options.maxDirectoryEntries ?? 2000;
  const excluded = new Set(options.excludedDirectories ?? DEFAULT_EXCLUDED_DIRECTORIES);

  const readFileTool: ToolRegistration = {
    definition: {
      name: 'read_file',
      description:
        'Read a UTF-8 text file inside the workspace. Paths are confined to the ' +
        'workspace root; traversal attempts are rejected.',
      inputSchema: z.object({
        path: z.string().describe('Workspace-relative path, e.g. src/main.ts'),
      }),
    },
    handler: async ({ path }) => {
      try {
        const absolute = resolveWorkspacePath(workspaceRoot, path);
        const info = await stat(absolute);

        if (info.isDirectory()) {
          return errorResult(`"${path}" is a directory. Use list_directory instead.`);
        }
        if (info.size > MAX_FILE_BYTES) {
          return errorResult(
            `"${path}" is ${info.size} bytes, exceeding the ${MAX_FILE_BYTES} byte limit.`,
          );
        }

        const content = await readFile(absolute, 'utf8');
        return jsonResult({
          path: toWorkspaceRelative(workspaceRoot, absolute),
          bytes: info.size,
          modifiedAt: info.mtimeMs,
          content: escapeHtmlLike(content),
        });
      } catch (error) {
        if (error instanceof PathTraversalError) {
          return errorResult(error.message);
        }
        return errorResult(`Failed to read "${path}": ${(error as Error).message}`);
      }
    },
  };

  const writeFileTool: ToolRegistration = {
    definition: {
      name: 'write_file',
      description:
        'Atomically create or overwrite a UTF-8 text file inside the workspace. ' +
        'The write is recorded in the execution log as an AI-authored change.',
      inputSchema: z.object({
        path: z.string().describe('Workspace-relative path, e.g. src/main.ts'),
        content: z.string().describe('Full new file content.'),
      }),
    },
    handler: async ({ path, content }) => {
      let absolute: string;
      try {
        absolute = resolveWorkspacePath(workspaceRoot, path);
      } catch (error) {
        if (error instanceof PathTraversalError) {
          return errorResult(error.message);
        }
        throw error;
      }

      let before = '';
      let existed = true;
      try {
        before = await readFile(absolute, 'utf8');
      } catch {
        existed = false;
      }

      const dir = dirname(absolute);
      const tempPath = join(dir, `.${basename(absolute)}.${randomUUID()}.tmp`);

      try {
        await mkdir(dir, { recursive: true });
        await writeFile(tempPath, content, 'utf8');
        await rename(tempPath, absolute);
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        return errorResult(`Failed to write "${path}": ${(error as Error).message}`);
      }

      const relative = toWorkspaceRelative(workspaceRoot, absolute);
      logger.record({
        filePath: relative,
        lineRange: [1, content.split('\n').length],
        author: 'AI',
        action: existed ? 'write_file' : 'create_file',
        delta: { before, after: content },
        metadata: { tool: 'write_file', bytes: Buffer.byteLength(content, 'utf8') },
      });

      return jsonResult({
        path: relative,
        created: !existed,
        bytesWritten: Buffer.byteLength(content, 'utf8'),
      });
    },
  };

  const listDirectoryTool: ToolRegistration = {
    definition: {
      name: 'list_directory',
      description:
        'Recursively list files and directories inside the workspace. ' +
        'Returns workspace-relative paths with type and size. Entries matched ' +
        'by a .gitignore in the workspace are omitted.',
      inputSchema: z.object({
        path: z
          .string()
          .default('.')
          .describe('Workspace-relative directory to list. Defaults to the root.'),
        maxDepth: z
          .number()
          .int()
          .min(0)
          .max(12)
          .default(6)
          .describe('Maximum recursion depth.'),
      }),
    },
    handler: async ({ path, maxDepth }) => {
      let root: string;
      try {
        root = resolveWorkspacePath(workspaceRoot, path);
      } catch (error) {
        if (error instanceof PathTraversalError) {
          return errorResult(error.message);
        }
        throw error;
      }

      const entries: Array<{ path: string; type: 'file' | 'directory'; size: number }> = [];
      let truncated = false;

      // Ignore rules are a stack of `.gitignore` sources from the root down to
      // the directory being walked; deeper files take precedence on a match.
      const sources: GitignoreSource[] = [];
      const rootIgnore = await loadGitignore(root, '');
      if (rootIgnore !== null) {
        sources.push(rootIgnore);
      }

      const walk = async (current: string, depth: number): Promise<void> => {
        if (depth > maxDepth || entries.length >= maxEntries) {
          truncated = entries.length >= maxEntries;
          return;
        }

        const dirents = await readdir(current, { withFileTypes: true });
        for (const dirent of dirents) {
          if (entries.length >= maxEntries) {
            truncated = true;
            return;
          }

          const child = join(current, dirent.name);
          const childRelative = toWorkspaceRelative(workspaceRoot, child);

          if (dirent.isDirectory()) {
            // Skipped entirely rather than listed but not descended into: a
            // directory that appears empty is a different, and more misleading,
            // claim than one that is simply not shown.
            if (excluded.has(dirent.name) || isPathIgnored(sources, childRelative, true)) {
              continue;
            }
            entries.push({ path: childRelative, type: 'directory', size: 0 });

            // A nested `.gitignore` narrows the rules for this subtree only;
            // it is pushed for the descent and popped on the way back out.
            const nested = await loadGitignore(child, childRelative);
            if (nested !== null) {
              sources.push(nested);
            }
            await walk(child, depth + 1);
            if (nested !== null) {
              sources.pop();
            }
          } else if (dirent.isFile()) {
            if (isPathIgnored(sources, childRelative, false)) {
              continue;
            }
            const info = await stat(child).catch(() => null);
            entries.push({ path: childRelative, type: 'file', size: info?.size ?? 0 });
          }
        }
      };

      try {
        await walk(root, 0);
      } catch (error) {
        return errorResult(`Failed to list "${path}": ${(error as Error).message}`);
      }

      // `readdir` returns entries in whatever order the filesystem keeps them,
      // which on ext4 is effectively arbitrary. A tree listed in an order nobody
      // can predict reads as broken even though it is correct, so the cost is
      // paid once here rather than by every consumer.
      entries.sort(compareEntries);

      return jsonResult({
        root: toWorkspaceRelative(workspaceRoot, root) || '.',
        count: entries.length,
        truncated,
        entries,
      });
    },
  };

  return [readFileTool, writeFileTool, listDirectoryTool];
}
