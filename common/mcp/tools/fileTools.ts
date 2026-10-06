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
 * The real answer is honouring `.gitignore`; a fixed list cannot know that a
 * project keeps source in `target/`. That is a separate change.
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
        'Returns workspace-relative paths with type and size.',
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
            if (excluded.has(dirent.name)) {
              continue;
            }
            entries.push({ path: childRelative, type: 'directory', size: 0 });
            await walk(child, depth + 1);
          } else if (dirent.isFile()) {
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
