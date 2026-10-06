/**
 * Workspace file explorer.
 *
 * Renders the workspace tree with per-file Git-like status badges (`M`, `N`) and
 * the number of inline diagnostics attached to each file.
 *
 * @module variants/desktop/src/components/FileExplorer
 */

import type { InlineHint } from '../lib/coreTypes.ts';
import { Icon, type IconName } from './Icon.tsx';

/** Git-like status of a workspace file. */
export type FileStatus = 'normal' | 'modified' | 'new';

/** A file known to the explorer. */
export interface WorkspaceFile {
  /** Workspace-relative, POSIX-style path. */
  readonly path: string;
  readonly status: FileStatus;
  /** Language id, used to pick an icon. */
  readonly language: string;
}

/** Props accepted by {@link FileExplorer}. */
export interface FileExplorerProps {
  readonly files: readonly WorkspaceFile[];
  /** Currently focused file, or `null`. */
  readonly activeFile: string | null;
  /** Active diagnostics, grouped by file internally. */
  readonly hints: readonly InlineHint[];
  /** Workspace root label shown as the tree root. */
  readonly rootLabel: string;
  readonly onSelect: (path: string) => void;
  readonly onNewFile: () => void;
  readonly onRefresh: () => void;
}

function iconFor(file: WorkspaceFile): IconName {
  if (file.language === 'typescript' || file.language === 'javascript' || file.language === 'python') {
    return 'file-code';
  }
  if (file.language === 'markdown') {
    return 'file-text';
  }
  return 'file-text';
}

function StatusTag({ status }: { readonly status: FileStatus }) {
  if (status === 'modified') {
    return (
      <span className="rounded border border-amber-500/30 bg-amber-500/20 px-1 text-[9px] text-amber-300">
        M
      </span>
    );
  }
  if (status === 'new') {
    return (
      <span className="rounded border border-emerald-500/30 bg-emerald-500/20 px-1 text-[9px] text-emerald-300">
        N
      </span>
    );
  }
  return null;
}

/**
 * Render the explorer sidebar.
 */
export function FileExplorer({
  files,
  activeFile,
  hints,
  rootLabel,
  onSelect,
  onNewFile,
  onRefresh,
}: FileExplorerProps) {
  const errorCounts = new Map<string, number>();
  const warningCounts = new Map<string, number>();

  for (const hint of hints) {
    const target = hint.severity === 'error' ? errorCounts : warningCounts;
    target.set(hint.filePath, (target.get(hint.filePath) ?? 0) + 1);
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800/80 bg-ide-sidebar">
      <div className="flex items-center justify-between border-b border-slate-800/80 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <span className="flex items-center gap-1.5">
          <Icon name="files" className="h-3.5 w-3.5" />
          Projetos
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewFile}
            title="Novo arquivo"
            className="rounded p-1 transition-colors hover:text-slate-200"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRefresh}
            title="Atualizar"
            className="rounded p-1 transition-colors hover:text-slate-200"
          >
            <Icon name="refresh" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="scrollbar-ide flex-1 overflow-y-auto py-2 font-mono text-xs">
        <div className="flex items-center gap-1 px-3 py-1 font-sans text-[11px] font-semibold text-slate-400">
          <Icon name="folder-git" className="h-3.5 w-3.5 text-indigo-400" />
          <span>{rootLabel}</span>
        </div>

        <div className="pl-2">
          {files.map((file) => {
            const isActive = file.path === activeFile;
            const errors = errorCounts.get(file.path) ?? 0;
            const warnings = warningCounts.get(file.path) ?? 0;

            return (
              <button
                key={file.path}
                type="button"
                onClick={() => onSelect(file.path)}
                className={`my-0.5 flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left transition-colors ${
                  isActive
                    ? 'border-l-2 border-indigo-500 bg-indigo-950/60 text-indigo-300'
                    : 'text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon name={iconFor(file)} className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  <span className="truncate">{file.path}</span>
                </span>

                <span className="flex shrink-0 items-center gap-1">
                  {errors > 0 && (
                    <span
                      title={`${errors} erro(s)`}
                      className="rounded border border-red-500/30 bg-red-500/20 px-1 text-[9px] text-red-300"
                    >
                      {errors}
                    </span>
                  )}
                  {warnings > 0 && (
                    <span
                      title={`${warnings} aviso(s)`}
                      className="rounded border border-amber-500/30 bg-amber-500/20 px-1 text-[9px] text-amber-300"
                    >
                      {warnings}
                    </span>
                  )}
                  <StatusTag status={file.status} />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5 border-t border-slate-800/80 bg-slate-950/40 p-3 font-mono text-[11px] text-slate-400">
        <div className="flex justify-between">
          <span>Arquivos:</span>
          <span className="text-indigo-400">{files.length}</span>
        </div>
        <div className="flex justify-between">
          <span>Diagnósticos:</span>
          <span className={hints.length > 0 ? 'text-amber-400' : 'text-emerald-400'}>
            {hints.length}
          </span>
        </div>
      </div>
    </aside>
  );
}
