/**
 * Minimal `.gitignore` support for the workspace walk.
 *
 * This is deliberately a **subset** of git's semantics, chosen to cover what an
 * editor explorer actually needs: comments, blank lines, `*`/`?`/`**`/`[...]`
 * globs, trailing `/` (directories only), leading `/` (anchor to the ignore
 * file's directory), `!` negation and the "last match wins" ordering. Escaped
 * `\#`, `\!` and trailing `\ ` are honoured.
 *
 * Not implemented (documented, not silent): backslash as a path separator on
 * Windows, `[abc]/` classes at the top of a pattern, and git's `\` quoting of
 * arbitrary characters. For the explorer's "hide noise" purpose these gaps are
 * acceptable, and the parser fails closed — an unparseable line is simply not a
 * pattern rather than a crash.
 *
 * @module common/mcp/tools/gitignore
 */

/** One compiled ignore rule from a `.gitignore` file. */
export interface GitignorePattern {
  /** Raw line the pattern came from, kept for diagnostics. */
  readonly source: string;
  /** `true` for a `!pattern` — a match re-includes rather than excludes. */
  readonly negated: boolean;
  /** Trailing `/`: the pattern only matches directories. */
  readonly directoryOnly: boolean;
  /** Contains a `/` (after trimming): anchored to the ignore file's directory. */
  readonly anchored: boolean;
  /** Full-match regex for the pattern body. */
  readonly regex: RegExp;
}

/** A parsed `.gitignore` file together with the directory it sits in. */
export interface GitignoreSource {
  /** Workspace-relative directory the file lives in; `''` for the root. */
  readonly baseDir: string;
  readonly patterns: readonly GitignorePattern[];
}

/** Escape regex metacharacters that are literal in a glob. */
function escapeRegex(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
}

/** Turn one glob fragment into a full-match regex source. */
function globToRegex(glob: string): string {
  let out = '';
  for (let index = 0; index < glob.length; index += 1) {
    // `index < glob.length` guarantees a character here; the fallback only
    // satisfies `noUncheckedIndexedAccess`.
    const character = glob[index] ?? '';
    if (character === '*') {
      if (glob[index + 1] === '*') {
        // `**/` matches zero or more directories; a bare `**` matches anything.
        if (glob[index + 2] === '/') {
          out += '(?:.*/)?';
          index += 2;
        } else {
          out += '.*';
          index += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (character === '?') {
      out += '[^/]';
    } else if (character === '[') {
      const end = glob.indexOf(']', index);
      if (end === -1) {
        out += '\\[';
      } else {
        let klass = glob.slice(index, end + 1);
        // `[!a]` is git's spelling of a negated class.
        if (klass.startsWith('[!')) {
          klass = `[^${klass.slice(2)}`;
        }
        out += klass;
        index = end;
      }
    } else {
      out += escapeRegex(character);
    }
  }
  return out;
}

/**
 * Parse the lines of one `.gitignore` into compiled patterns.
 *
 * @param content - The raw file text.
 * @returns The patterns in file order; negation and "last match wins" rely on
 * this order being preserved.
 */
export function parseGitignore(content: string): GitignorePattern[] {
  const patterns: GitignorePattern[] = [];

  for (const raw of content.split(/\r?\n/u)) {
    // Trailing whitespace is ignored unless escaped with a backslash.
    let line = raw.replace(/(?<!\\)[ \t]+$/u, '');
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    }

    // A leading `\#` or `\!` means a literal character, not a comment/negation.
    if (line.startsWith('\\#') || line.startsWith('\\!')) {
      line = line.slice(1);
    }

    let directoryOnly = false;
    if (line.endsWith('/')) {
      directoryOnly = true;
      line = line.slice(0, -1);
    }

    let anchored = false;
    if (line.startsWith('/')) {
      anchored = true;
      line = line.slice(1);
    } else if (line.includes('/')) {
      anchored = true;
    }

    // Unescape the few quoted characters the parser recognises.
    line = line.replace(/\\#/gu, '#').replace(/\\!/gu, '!').replace(/\\ /gu, ' ');

    if (line === '') {
      continue;
    }

    patterns.push({
      source: raw,
      negated,
      directoryOnly,
      anchored,
      regex: new RegExp(`^${globToRegex(line)}$`, 'u'),
    });
  }

  return patterns;
}

/** Last path segment of a workspace-relative path (`src/main.ts` → `main.ts`). */
function basenameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/** Path relative to a gitignore file's directory. */
function relativeToBase(baseDir: string, path: string): string {
  if (baseDir === '' || baseDir === '.') {
    return path;
  }
  const prefix = `${baseDir}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/**
 * Decide whether a workspace-relative path is ignored by a stack of
 * `.gitignore` sources (root-first, deepest-last).
 *
 * Matching follows git's "last match wins": the rules are walked in order and
 * each match flips the result, so a later `!pattern` re-includes what an earlier
 * pattern excluded.
 *
 * @param sources - Sources from the root down to the entry's directory.
 * @param path - Workspace-relative path of the entry.
 * @param isDirectory - Whether the entry is a directory (matters for trailing-`/`
 * rules).
 */
export function isPathIgnored(
  sources: readonly GitignoreSource[],
  path: string,
  isDirectory: boolean,
): boolean {
  let ignored = false;
  for (const source of sources) {
    const relative = relativeToBase(source.baseDir, path);
    for (const pattern of source.patterns) {
      if (pattern.directoryOnly && !isDirectory) {
        continue;
      }
      const target = pattern.anchored ? relative : basenameOf(path);
      if (pattern.regex.test(target)) {
        ignored = !pattern.negated;
      }
    }
  }
  return ignored;
}
