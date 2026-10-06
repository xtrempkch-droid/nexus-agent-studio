import { describe, expect, it } from 'vitest';
import { GIT_HELPER_MANIFEST, parsePorcelainBlame } from './git-helper.plg.ts';

const PORCELAIN = [
  '0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c 1 1 1',
  'author Ada Lovelace',
  'author-mail <ada@example.com>',
  'author-time 1700000000',
  'author-tz +0000',
  'committer Ada Lovelace',
  'committer-time 1700000000',
  'summary Initial commit',
  'filename src/main.py',
  '\timport math',
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4 2 2 1',
  'author Grace Hopper',
  'author-time 1700003600',
  '\t',
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4 3 3 1',
  'author Grace Hopper',
  'author-time 1700003600',
  '\tdef main():',
].join('\n');

describe('parsePorcelainBlame', () => {
  it('parses each blamed line', () => {
    const lines = parsePorcelainBlame(PORCELAIN);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({
      line: 1,
      commit: '0f1a2b3c',
      author: 'Ada Lovelace',
      authoredAt: new Date(1_700_000_000 * 1000).toISOString(),
      content: 'import math',
    });
  });

  it('associates the correct author per commit', () => {
    const lines = parsePorcelainBlame(PORCELAIN);
    expect(lines[1]?.author).toBe('Grace Hopper');
    expect(lines[2]?.author).toBe('Grace Hopper');
    expect(lines[1]?.commit).toBe('a1b2c3d4');
  });

  it('keeps empty content lines', () => {
    const lines = parsePorcelainBlame(PORCELAIN);
    expect(lines[1]?.content).toBe('');
  });

  it('returns an empty array for empty input', () => {
    expect(parsePorcelainBlame('')).toEqual([]);
  });

  it('ignores metadata that appears before any header', () => {
    expect(parsePorcelainBlame('author Nobody\ngarbage')).toEqual([]);
  });
});

describe('GIT_HELPER_MANIFEST', () => {
  it('is a valid-looking manifest', () => {
    expect(GIT_HELPER_MANIFEST.id).toMatch(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);
    expect(GIT_HELPER_MANIFEST.version).toMatch(/^\d+\.\d+\.\d+/u);
    expect(GIT_HELPER_MANIFEST.permissions.terminal).toBe(true);
    expect(GIT_HELPER_MANIFEST.permissions.network).toBe(false);
  });
});
