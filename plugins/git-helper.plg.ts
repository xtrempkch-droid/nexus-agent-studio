/**
 * Example plugin: Git Blame in the Docker sandbox.
 *
 * Demonstrates the full plugin contract:
 *
 * - declares its capabilities in the manifest;
 * - registers an MCP tool (`git_blame_docker`) on load;
 * - runs `git blame` inside the sandbox, never on the host;
 * - returns a line-by-line authorship map that a local model can consume;
 * - releases its registrations on unload (handled by `PluginManager`).
 *
 * @module plugins/git-helper.plg
 */

import * as z from 'zod/v4';
import type {
  PluginContext,
  PluginLifecycle,
  PluginManifest,
} from '../common/plugins/types.ts';
import { errorResult, jsonResult } from '../common/mcp/types.ts';

/** Static metadata for this plugin. */
export const GIT_HELPER_MANIFEST: PluginManifest = Object.freeze({
  id: 'nexus.git-helper',
  name: 'Git Helper (Docker)',
  version: '1.0.0',
  entryPoint: 'plugins/git-helper.plg.ts',
  description: 'Runs git blame inside the sandbox and returns line authorship.',
  permissions: Object.freeze({
    filesystem: true,
    terminal: true,
    network: false,
    mcpTools: true,
  }),
});

/** One `git blame` entry. */
export interface BlameLine {
  /** 1-based line number in the final file. */
  readonly line: number;
  /** Commit hash that last touched the line. */
  readonly commit: string;
  /** Author name, when available. */
  readonly author: string;
  /** Author timestamp (ISO 8601), when available. */
  readonly authoredAt: string | null;
  /** The line's content, as recorded by git. */
  readonly content: string;
}

/**
 * Parse `git blame --line-porcelain` output into structured entries.
 *
 * Format: a header line `<sha> <orig-line> <final-line> [<group>]`, followed by
 * `key value` metadata lines, then a TAB-prefixed content line.
 *
 * @param raw - Raw porcelain output.
 */
export function parsePorcelainBlame(raw: string): BlameLine[] {
  const lines = raw.split(/\r?\n/u);
  const results: BlameLine[] = [];

  let commit = '';
  let finalLine = 0;
  let author = '';
  let authoredAt: string | null = null;

  const headerPattern = /^(?<sha>[0-9a-f]{7,40})\s+\d+\s+(?<line>\d+)(?:\s+\d+)?$/u;

  for (const line of lines) {
    const header = headerPattern.exec(line);
    if (header?.groups) {
      commit = header.groups['sha'] ?? '';
      finalLine = Number(header.groups['line']);
      author = '';
      authoredAt = null;
      continue;
    }

    if (line.startsWith('author ')) {
      author = line.slice('author '.length);
      continue;
    }
    if (line.startsWith('author-time ')) {
      const seconds = Number(line.slice('author-time '.length));
      authoredAt = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
      continue;
    }
    if (line.startsWith('\t')) {
      results.push({
        line: finalLine,
        commit: commit.slice(0, 8),
        author,
        authoredAt,
        content: line.slice(1),
      });
    }
  }

  return results;
}

/**
 * Plugin implementation.
 */
export default class GitHelperPlugin implements PluginLifecycle {
  /**
   * Register the `git_blame_docker` tool.
   *
   * @param context - Controlled core services.
   */
  public async onLoad(context: PluginContext): Promise<void> {
    if (context.manifest.permissions.terminal !== true) {
      throw new Error('git-helper requires the "terminal" permission.');
    }

    context.registerTool(
      {
        name: 'git_blame_docker',
        description:
          'Run `git blame` inside the Docker sandbox and return a per-line ' +
          'authorship map (commit, author, timestamp, content).',
        inputSchema: z.object({
          path: z.string().describe('Workspace-relative file to blame.'),
          startLine: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('First line of the range to blame.'),
          endLine: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Last line of the range to blame (inclusive).'),
          image: z
            .string()
            .default('alpine/git:latest')
            .describe('Image providing the git binary.'),
        }),
      },
      async ({ path, startLine, endLine, image }) => {
        const range =
          startLine !== undefined && endLine !== undefined
            ? `-L ${startLine},${endLine}`
            : startLine !== undefined
              ? `-L ${startLine},+1`
              : '';

        // Quoting: `path` is single-quoted; embedded quotes are escaped.
        const safePath = path.replace(/'/gu, `'\\''`);
        const command = `git -C /workspace blame --line-porcelain ${range} -- '${safePath}'`;

        try {
          const result = await context.terminal.run(command, {
            image,
            network: 'none',
          });

          context.logger.record({
            filePath: `plugin://${context.manifest.id}`,
            lineRange: [startLine ?? 0, endLine ?? 0],
            author: 'AI',
            action: 'git_blame_docker',
            delta: { before: '', after: command },
            metadata: {
              pluginId: context.manifest.id,
              containerId: result.containerId,
              exitCode: result.exitCode,
            },
          });

          if (result.exitCode !== 0) {
            return errorResult(
              `git blame failed (exit ${result.exitCode}):\n${result.stderr.trim()}`,
            );
          }

          const blame = parsePorcelainBlame(result.stdout);
          return jsonResult({
            path,
            containerId: result.containerId,
            lines: blame.length,
            blame,
          });
        } catch (error) {
          return errorResult(`git blame could not run: ${(error as Error).message}`);
        }
      },
    );
  }

  /** No resources are held between calls. */
  public async onUnload(): Promise<void> {
    // Tools registered via `context.registerTool` are removed by PluginManager.
  }
}
