/**
 * Tests for the `.gitignore` parser and matcher.
 *
 * The module implements a documented subset of git's semantics; these tests pin
 * down that subset precisely — globs, anchoring, directory-only rules,
 * negation, nested-file precedence and the "last match wins" ordering.
 *
 * @module common/mcp/tools/gitignore.test
 */

import { describe, expect, it } from 'vitest';
import { isPathIgnored, parseGitignore, type GitignoreSource } from './gitignore.ts';

function source(baseDir: string, content: string): GitignoreSource {
  return { baseDir, patterns: parseGitignore(content) };
}

function ignored(
  sources: readonly GitignoreSource[],
  path: string,
  isDirectory: boolean,
): boolean {
  return isPathIgnored(sources, path, isDirectory);
}

describe('parseGitignore', () => {
  it('skips blank lines and comments', () => {
    expect(parseGitignore('\n  \n# a comment\n*.log\n')).toHaveLength(1);
  });

  it('recognises negation, directory-only and anchored flags', () => {
    const [pattern] = parseGitignore('!build/');
    if (pattern === undefined) {
      throw new Error('expected one pattern');
    }
    expect(pattern.negated).toBe(true);
    expect(pattern.directoryOnly).toBe(true);
    expect(pattern.anchored).toBe(false);

    const [anchored] = parseGitignore('/dist');
    expect(anchored?.anchored).toBe(true);
  });

  it('treats an escaped leading hash or bang as literal text', () => {
    const [hash] = parseGitignore('\\#generated');
    const [bang] = parseGitignore('\\!important.log');
    expect(hash?.negated).toBe(false);
    expect(bang?.negated).toBe(false);
  });
});

describe('isPathIgnored', () => {
  it('matches a simple basename glob at any depth', () => {
    const sources = [source('', '*.log\n')];
    expect(ignored(sources, 'debug.log', false)).toBe(true);
    expect(ignored(sources, 'src/debug.log', false)).toBe(true);
    expect(ignored(sources, 'src/main.ts', false)).toBe(false);
  });

  it('matches a directory-only rule on directories but not files', () => {
    const sources = [source('', 'build/\n')];
    expect(ignored(sources, 'build', true)).toBe(true);
    expect(ignored(sources, 'build', false)).toBe(false);
  });

  it('anchors a leading-slash pattern to the ignore file directory', () => {
    const sources = [source('', '/dist/\n')];
    expect(ignored(sources, 'dist', true)).toBe(true);
    // `dist` under a subdirectory is not at the root, so it is not matched.
    expect(ignored(sources, 'src/dist', true)).toBe(false);
  });

  it('treats a mid-pattern slash as anchoring too', () => {
    const sources = [source('', 'docs/tmp\n')];
    expect(ignored(sources, 'docs/tmp', false)).toBe(true);
    expect(ignored(sources, 'tmp', false)).toBe(false);
  });

  it('re-includes with a later negation (last match wins)', () => {
    const sources = [source('', '*.log\n!keep.log\n')];
    expect(ignored(sources, 'drop.log', false)).toBe(true);
    expect(ignored(sources, 'keep.log', false)).toBe(false);
  });

  it('lets a deeper gitignore override the root', () => {
    const root = source('', '*.log\n');
    const nested = source('src', '!keep.log\n');
    expect(ignored([root, nested], 'src/drop.log', false)).toBe(true);
    expect(ignored([root, nested], 'src/keep.log', false)).toBe(false);
  });

  it('matches a `**` glob across directory boundaries', () => {
    const sources = [source('', '**/generated/**\n')];
    expect(ignored(sources, 'generated/out.js', false)).toBe(true);
    expect(ignored(sources, 'a/b/generated/out.js', false)).toBe(true);
    expect(ignored(sources, 'src/main.ts', false)).toBe(false);
  });

  it('matches a character class', () => {
    const sources = [source('', '*.min.[jt]s\n')];
    expect(ignored(sources, 'app.min.js', false)).toBe(true);
    expect(ignored(sources, 'app.min.ts', false)).toBe(true);
    expect(ignored(sources, 'app.min.css', false)).toBe(false);
  });
});
