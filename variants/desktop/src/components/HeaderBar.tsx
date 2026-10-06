/**
 * Top application header: brand, workspace, model picker, agent-control mode
 * switcher and the local-model connection badge.
 *
 * @module variants/desktop/src/components/HeaderBar
 */

import { Icon } from './Icon.tsx';

/** How much autonomy the agent has. */
export type AgentMode = 'assisted' | 'autonomous';

/** A selectable local model. */
export interface ModelOption {
  readonly id: string;
  readonly label: string;
}

/** Props accepted by {@link HeaderBar}. */
export interface HeaderBarProps {
  readonly workspaceLabel: string;
  readonly models: readonly ModelOption[];
  readonly selectedModel: string;
  readonly onModelChange: (modelId: string) => void;
  readonly mode: AgentMode;
  readonly onModeChange: (mode: AgentMode) => void;
  /** Short label for the connection badge, e.g. `Simulação` or `Ollama Online`. */
  readonly connectionLabel: string;
  /** Tailwind classes for the connection status dot. */
  readonly connectionDotClass: string;
  readonly onOpenSettings: () => void;
}

const MODE_BASE =
  'flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-all';

/**
 * Render the application header.
 */
export function HeaderBar({
  workspaceLabel,
  models,
  selectedModel,
  onModelChange,
  mode,
  onModeChange,
  connectionLabel,
  connectionDotClass,
  onOpenSettings,
}: HeaderBarProps) {
  return (
    <header className="z-20 flex h-12 shrink-0 items-center justify-between border-b border-slate-800/80 bg-ide-sidebar px-4 text-xs">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-100">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 text-white shadow-lg shadow-indigo-500/20">
            <Icon name="bot" className="h-4 w-4" />
          </span>
          <span>
            NexusAgent{' '}
            <span className="rounded border border-indigo-500/30 bg-indigo-500/20 px-1.5 py-0.5 font-mono text-[10px] font-normal text-indigo-300">
              PRO
            </span>
          </span>
        </div>

        <span className="text-slate-700">|</span>

        <div className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/80 px-2.5 py-1 font-mono text-[11px] text-slate-400">
          <Icon name="folder-git" className="h-3.5 w-3.5 text-indigo-400" />
          <span className="text-slate-300">{workspaceLabel}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/90 p-1">
          <Icon name="cpu" className="ml-1.5 h-3.5 w-3.5 text-indigo-400" />
          <label className="sr-only" htmlFor="model-select">
            Modelo
          </label>
          <select
            id="model-select"
            value={selectedModel}
            onChange={(event) => onModelChange(event.target.value)}
            className="cursor-pointer bg-transparent pr-2 font-mono text-xs text-slate-200 focus:outline-none"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id} className="bg-slate-900">
                {model.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-1">
          <button
            type="button"
            onClick={() => onModeChange('assisted')}
            className={`${MODE_BASE} ${
              mode === 'assisted'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon name="user-check" className="h-3.5 w-3.5" />
            <span>Assistido</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange('autonomous')}
            className={`${MODE_BASE} ${
              mode === 'autonomous'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon name="zap" className="h-3.5 w-3.5" />
            <span>Autônomo</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 font-mono text-[11px] text-slate-300 transition-all hover:border-slate-700"
        >
          <span className={`h-2 w-2 rounded-full ${connectionDotClass}`} />
          <span>{connectionLabel}</span>
          <Icon name="settings" className="ml-1 h-3.5 w-3.5 text-slate-400" />
        </button>
      </div>
    </header>
  );
}
