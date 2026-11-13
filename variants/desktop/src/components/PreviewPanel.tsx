/**
 * Preview panel: render the open file and show what its console says.
 *
 * The document runs inside a **sandboxed iframe** (`allow-scripts`, deliberately
 * without `allow-same-origin`): the page gets a unique origin, so its script
 * cannot read this app's DOM, `localStorage` or the Tauri bridge. That sandbox is
 * the security boundary; the escaping in `lib/preview.ts` keeps the output tidy,
 * it is not what stops an attack.
 *
 * Two honest limits, stated in the UI rather than discovered later:
 * - a page's own external files (`style.css`, images) are **not** loaded, because
 *   the preview has no server to resolve them against;
 * - binary formats (images, PDFs) cannot be read by the core, which is text-only.
 *
 * @module variants/desktop/src/components/PreviewPanel
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildPreviewDocument,
  parseConsoleMessage,
  previewKindOf,
  type PreviewConsoleLine,
} from '../lib/preview.ts';
import { Icon } from './Icon.tsx';

/** Lines kept before the oldest are dropped. */
const MAX_LINES = 200;

/** Props for {@link PreviewPanel}. */
export interface PreviewPanelProps {
  /** Workspace-relative path of the file being previewed. */
  readonly path: string;
  /** Current editor content of that file. */
  readonly content: string;
  /** Bumped by the shell's `Executar` shortcut to force a reload. */
  readonly runSignal: number;
}

/** Colour per console level, matching the terminal panel's palette. */
const LEVEL_CLASS: Readonly<Record<PreviewConsoleLine['level'], string>> = {
  log: 'text-slate-300',
  info: 'text-sky-300',
  warn: 'text-amber-300',
  error: 'text-red-400',
  debug: 'text-slate-500',
};

/**
 * Render the preview and its console.
 */
export function PreviewPanel({ path, content, runSignal }: PreviewPanelProps) {
  const kind = useMemo(() => previewKindOf(path), [path]);
  const [lines, setLines] = useState<readonly PreviewConsoleLine[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // A different file starts a new console: keeping the previous file's output
  // would attribute one page's errors to another.
  useEffect(() => {
    setLines([]);
  }, [path]);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const line = parseConsoleMessage(event.data);
      if (line === null) {
        return;
      }
      setLines((previous) => [...previous, line].slice(-MAX_LINES));
    };

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, []);

  useEffect(() => {
    const node = listRef.current;
    if (node !== null) {
      node.scrollTop = node.scrollHeight;
    }
  }, [lines]);

  const document = useMemo(
    () => (kind === 'none' || path === '' ? '' : buildPreviewDocument(kind, content)),
    // `runSignal` is in the dependency list on purpose: recomputing the string is
    // what reloads the frame when the user presses Executar without editing.
    [kind, content, path, runSignal],
  );

  const clear = useCallback(() => setLines([]), []);
  const errors = lines.filter((line) => line.level === 'error').length;

  if (path === '') {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950 font-mono text-xs text-slate-500">
        Abra um arquivo para ver a pré-visualização.
      </div>
    );
  }

  if (kind === 'none') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-950 px-6 text-center font-mono text-xs text-slate-500">
        <Icon name="eye" className="h-5 w-5" />
        <p>
          <span className="text-slate-300">{path}</span> é um formato binário.
        </p>
        <p className="max-w-md leading-relaxed">
          A pré-visualização trabalha com texto — HTML, Markdown, JSON e código. Imagens e
          PDFs ainda não são renderizados.
        </p>
      </div>
    );
  }

  const notes: string[] = [];
  if (kind === 'html') {
    notes.push('CSS, imagens e scripts externos não são carregados: a pré-visualização não tem servidor.');
  }

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-800/80 px-3 py-1 font-mono text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5 text-slate-300">
          <Icon name="eye" className="h-3.5 w-3.5" />
          {kind === 'html' ? 'HTML' : kind === 'markdown' ? 'Markdown' : kind === 'json' ? 'JSON' : 'Texto'}
        </span>
        <span className="truncate text-slate-500">{path}</span>
        <span className="ml-auto flex items-center gap-3">
          <span className={errors > 0 ? 'text-red-400' : 'text-slate-500'}>
            {errors === 0 ? 'sem erros' : `${String(errors)} erro${errors === 1 ? '' : 's'}`}
          </span>
          <span className="text-slate-500">{String(lines.length)} linhas no console</span>
          <button
            type="button"
            onClick={clear}
            className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-slate-300 hover:bg-slate-700"
          >
            Limpar
          </button>
        </span>
      </div>

      <div className="min-h-0 flex-1 bg-white">
        <iframe
          key={`${kind}-${path}`}
          title={`Pré-visualização de ${path}`}
          // No `allow-same-origin` on purpose: with it, the page would share this
          // origin and could reach the app and the Tauri bridge.
          sandbox="allow-scripts allow-forms"
          srcDoc={document}
          className="h-full w-full border-0 bg-white"
        />
      </div>

      <div className="flex h-28 shrink-0 flex-col border-t border-slate-800/80">
        <div
          ref={listRef}
          className="scrollbar-ide flex-1 overflow-y-auto px-3 py-1 font-mono text-[11px] leading-relaxed"
        >
          {lines.length === 0 ? (
            <span className="text-slate-600">
              Nada no console. `console.log`, avisos e erros da página aparecem aqui.
            </span>
          ) : (
            lines.map((line, index) => (
              <div key={`line-${String(index)}`} className={LEVEL_CLASS[line.level]}>
                <span className="mr-2 text-slate-600">{line.level}</span>
                {line.text}
              </div>
            ))
          )}
        </div>
        {notes.length > 0 && (
          <div className="shrink-0 border-t border-slate-800/60 px-3 py-1 text-[10px] text-slate-500">
            {notes.join(' ')}
          </div>
        )}
      </div>
    </div>
  );
}
