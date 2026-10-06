/**
 * Docker terminal output renderer.
 *
 * Renders the sandboxed command's combined output in a dark, monospace panel
 * with ANSI colour support and a reactive {@link StatusBadge}. `stdout` and
 * `stderr` are kept in separate lines so diagnostics stay visually distinct.
 *
 * @module variants/desktop/src/components/TerminalOutput
 */

import { useMemo } from 'react';
import { parseAnsi } from '../lib/ansi.ts';
import { Icon } from './Icon.tsx';
import { StatusBadge, type SandboxStatus } from './StatusBadge.tsx';

/** One line of captured output. */
export interface TerminalLine {
  readonly id: string;
  /** Which stream produced the line. */
  readonly stream: 'stdout' | 'stderr' | 'system';
  /** Raw text, possibly containing ANSI escapes. */
  readonly text: string;
}

/** Props accepted by {@link TerminalOutput}. */
export interface TerminalOutputProps {
  readonly lines: readonly TerminalLine[];
  readonly status: SandboxStatus;
  /** Image the container ran. */
  readonly image?: string;
  /** Container name/id reported by the sandbox. */
  readonly containerId?: string;
  /** Exit code of the last execution. */
  readonly exitCode?: number;
  /** Invoked when the user clears the panel. */
  readonly onClear?: () => void;
}

const STREAM_CLASS: Readonly<Record<TerminalLine['stream'], string>> = {
  stdout: 'text-slate-300',
  stderr: 'text-red-300',
  system: 'italic text-slate-500',
};

const STREAM_PREFIX: Readonly<Record<TerminalLine['stream'], string>> = {
  stdout: '',
  stderr: '! ',
  system: '# ',
};

/**
 * Render a single line, converting ANSI escapes into styled spans.
 */
function TerminalRow({ line }: { readonly line: TerminalLine }) {
  const spans = useMemo(() => parseAnsi(line.text), [line.text]);

  return (
    <div className={`whitespace-pre-wrap break-words ${STREAM_CLASS[line.stream]}`}>
      <span className="select-none">{STREAM_PREFIX[line.stream]}</span>
      {spans.length === 0 ? (
        <span>&nbsp;</span>
      ) : (
        spans.map((span, index) => (
          <span key={`${line.id}-${index}`} className={span.className}>
            {span.text}
          </span>
        ))
      )}
    </div>
  );
}

/**
 * Dark-mode terminal panel with a reactive sandbox status badge.
 */
export function TerminalOutput({
  lines,
  status,
  image,
  containerId,
  exitCode,
  onClear,
}: TerminalOutputProps) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-slate-950" aria-label="Saída do terminal">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800/80 bg-ide-sidebar px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <Icon name="terminal" className="h-3.5 w-3.5" />
          <span>Terminal do Agente</span>
        </div>

        <div className="flex items-center gap-2">
          <StatusBadge
            status={status}
            {...(image === undefined ? {} : { image })}
            {...(containerId === undefined ? {} : { containerId })}
            {...(exitCode === undefined ? {} : { exitCode })}
          />
          {onClear !== undefined && (
            <button
              type="button"
              onClick={onClear}
              title="Limpar terminal"
              className="rounded p-1 text-slate-500 transition-colors hover:text-slate-200"
            >
              <Icon name="trash" className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </header>

      <div className="scrollbar-ide min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed">
        {lines.length === 0 ? (
          <div className="italic text-slate-500">
            $ Agente Nexus inicializado. Nenhum comando executado ainda.
          </div>
        ) : (
          lines.map((line) => <TerminalRow key={line.id} line={line} />)
        )}
      </div>
    </section>
  );
}
