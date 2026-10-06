/**
 * Workspace file explorer.
 *
 * Renders the workspace tree with per-file Git-like status badges (`M`, `N`) and
 * the number of inline diagnostics attached to each file.
 *
 * @module variants/desktop/src/components/FileExplorer
 */

import type { InlineHint } from '../lib/coreTypes.ts';
import type { DirectoryEntry } from '../lib/coreClient.ts';
import { Icon, type IconName } from './Icon.tsx';

/** Git-like status of a workspace file. */
export type FileStatus = 'normal' | 'modified' | 'new';

/** Props accepted by {@link FileExplorer}. */
export interface FileExplorerProps {
  /** Entries of the current directory, files and subdirectories together. */
  readonly entries: readonly DirectoryEntry[];
  /** Currently focused file, or `null`. */
  readonly activeFile: string | null;
  /** Workspace-relative directory being shown; `.` is the root. */
  readonly currentDir: string;
  /** Active diagnostics, grouped by file internally. */
  readonly hints: readonly InlineHint[];
  /** Per-file Git-like status, keyed by workspace-relative path. */
  readonly statuses: Readonly<Record<string, FileStatus>>;
  /** Workspace root label shown as the tree root. */
  readonly rootLabel: string;
  readonly onOpenFile: (path: string) => void;
  readonly onOpenDirectory: (path: string) => void;
  readonly onNavigateUp: () => void;
  readonly onNewFile: () => void;
  readonly onRefresh: () => void;
  /** Open the native folder picker to choose another project. */
  readonly onOpenWorkspace: () => void;
}

/** Parent directory of a workspace-relative path; `.` at the root. */
export function parentOf(dir: string): string {
  if (dir === '.' || dir === '') {
    return '.';
  }
  const index = dir.lastIndexOf('/');
  return index <= 0 ? '.' : dir.slice(0, index);
}

/** Breadcrumb segments from the root down to `dir`, or empty at the root. */
function breadcrumbSegments(dir: string): readonly string[] {
  if (dir === '.' || dir === '') {
    return [];
  }
  return dir.split('/').filter((segment) => segment !== '');
}

/** Pick an icon for an entry: folders and code files are told apart visually. */
function iconFor(entry: DirectoryEntry): IconName {
  if (entry.type === 'directory') {
    return 'folder';
  }
  const dot = entry.path.lastIndexOf('.');
  const extension = dot === -1 ? '' : entry.path.slice(dot + 1).toLowerCase();
  if (
    extension === 'ts' ||
    extension === 'tsx' ||
    extension === 'js' ||
    extension === 'jsx' ||
    extension === 'mjs' ||
    extension === 'cjs' ||
    extension === 'py' ||
    extension === 'rs'
  ) {
    return 'file-code';
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
  entries,
  activeFile,
  currentDir,
  hints,
  statuses,
  rootLabel,
  onOpenFile,
  onOpenDirectory,
  onNavigateUp,
  onNewFile,
  onRefresh,
  onOpenWorkspace,
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
            onClick={onOpenWorkspace}
            title="Abrir projeto"
            className="rounded p-1 transition-colors hover:text-slate-200"
          >
            <Icon name="folder-open" className="h-3.5 w-3.5" />
          </button>
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
        {/* Breadcrumb: the root is always shown; deeper segments are clickable. */}
        <div className="flex items-center gap-0.5 px-3 py-1 font-sans text-[11px] font-semibold text-slate-400">
          {currentDir !== '.' && (
            <button
              type="button"
              onClick={onNavigateUp}
              title="Subir um nível"
              className="mr-1 rounded border border-slate-800 px-1.5 py-0.5 text-slate-300 hover:bg-slate-900 hover:text-slate-100"
            >
              ..
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenDirectory('.')}
            className="flex items-center gap-1 hover:text-slate-200"
          >
            <Icon name="folder-git" className="h-3.5 w-3.5 text-indigo-400" />
            <span>{rootLabel}</span>
          </button>
          {breadcrumbSegments(currentDir).map((segment, index, segments) => {
            const target = segments.slice(0, index + 1).join('/');
            return (
              <span key={target} className="flex items-center gap-0.5">
                <span className="text-slate-600">/</span>
                <button
                  type="button"
                  onClick={() => onOpenDirectory(target)}
                  className="hover:text-slate-200"
                >
                  {segment}
                </button>
              </span>
            );
          })}
        </div>

        {entries.length === 0 ? (
          <div className="px-3 py-4 font-sans text-[11px] text-slate-500">Pasta vazia.</div>
        ) : (
          <div className="pl-2">
            {entries.map((entry) => {
              const isActive = entry.type === 'file' && entry.path === activeFile;
              const errors = entry.type === 'file' ? (errorCounts.get(entry.path) ?? 0) : 0;
              const warnings = entry.type === 'file' ? (warningCounts.get(entry.path) ?? 0) : 0;

              return (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() =>
                    entry.type === 'directory'
                      ? onOpenDirectory(entry.path)
                      : onOpenFile(entry.path)
                  }
                  className={`my-0.5 flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left transition-colors ${
                    isActive
                      ? 'border-l-2 border-indigo-500 bg-indigo-950/60 text-indigo-300'
                      : 'text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Icon
                      name={iconFor(entry)}
                      className={`h-3.5 w-3.5 shrink-0 ${
                        entry.type === 'directory' ? 'text-amber-400' : 'text-indigo-400'
                      }`}
                    />
                    <span className="truncate">
                      {entry.type === 'directory' ? `${entry.path}/` : entry.path}
                    </span>
                  </span>

                  {entry.type === 'file' && (
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
                      <StatusTag status={statuses[entry.path] ?? 'normal'} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-1.5 border-t border-slate-800/80 bg-slate-950/40 p-3 font-mono text-[11px] text-slate-400">
        <div className="flex justify-between">
          <span>Entradas:</span>
          <span className="text-indigo-400">{entries.length}</span>
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
