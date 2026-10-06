/**
 * Minimal ANSI SGR parser.
 *
 * The sandbox returns raw `stdout`/`stderr`, which frequently contains ANSI
 * colour escapes from compilers and test runners. This converts a string into
 * spans carrying a CSS class, so the terminal renders colours without
 * `dangerouslySetInnerHTML`.
 *
 * Supported: reset (0), bold (1) and the 30–37 / 90–97 foreground colours.
 *
 * @module variants/desktop/src/lib/ansi
 */

/** A run of text sharing one styling. */
export interface AnsiSpan {
  readonly text: string;
  readonly className: string;
}

const ANSI_PATTERN = /\u001b\[([0-9;]*)m/gu;

const FOREGROUND_CLASS: Readonly<Record<number, string>> = {
  30: 'ansi-grey',
  31: 'ansi-red',
  32: 'ansi-green',
  33: 'ansi-yellow',
  34: 'ansi-blue',
  35: 'ansi-magenta',
  36: 'ansi-cyan',
  37: 'ansi-white',
  90: 'ansi-grey',
  91: 'ansi-red',
  92: 'ansi-green',
  93: 'ansi-yellow',
  94: 'ansi-blue',
  95: 'ansi-magenta',
  96: 'ansi-cyan',
  97: 'ansi-white',
};

function isForeground(classNames: readonly string[]): boolean {
  return classNames.some((name) => name !== 'ansi-bold');
}

/**
 * Split `input` into styled spans.
 *
 * @param input - Raw text, possibly containing ANSI SGR escapes.
 * @returns Spans in source order. Plain text yields a single unstyled span.
 */
export function parseAnsi(input: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let active: string[] = [];
  let cursor = 0;

  ANSI_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ANSI_PATTERN.exec(input)) !== null) {
    const text = input.slice(cursor, match.index);
    if (text !== '') {
      spans.push({ text, className: active.join(' ') });
    }

    const raw = match[1] ?? '';
    const codes = raw === '' ? [0] : raw.split(';').map(Number);

    for (const code of codes) {
      if (code === 0) {
        active = [];
      } else if (code === 1) {
        if (!active.includes('ansi-bold')) {
          active.push('ansi-bold');
        }
      } else {
        const cls = FOREGROUND_CLASS[code];
        if (cls !== undefined) {
          active = [...active.filter((name) => !isForeground([name]) || name === 'ansi-bold'), cls];
        }
      }
    }

    cursor = match.index + match[0].length;
  }

  const tail = input.slice(cursor);
  if (tail !== '') {
    spans.push({ text: tail, className: active.join(' ') });
  }

  return spans;
}

/**
 * Remove ANSI escapes from a string.
 */
export function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/gu, '');
}
