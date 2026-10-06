/**
 * Reactive Docker sandbox status badge.
 *
 * Reflects the lifecycle of a sandboxed execution:
 *
 * | state | badge |
 * | --- | --- |
 * | `idle` | ⚪ Sandbox ocioso |
 * | `executing` | ⏳ Executando em Ambiente Isolado… |
 * | `success` | 🟢 Docker Sandbox Active [Container: img] |
 * | `error` | 🔴 Compilation Error (Exit Code N) |
 *
 * @module variants/desktop/src/components/StatusBadge
 */

/** Lifecycle of the last (or in-flight) sandboxed execution. */
export type SandboxStatus = 'idle' | 'executing' | 'success' | 'error';

/** Props accepted by {@link StatusBadge}. */
export interface StatusBadgeProps {
  readonly status: SandboxStatus;
  /** Image the container ran, shown while active or successful. */
  readonly image?: string;
  /** Container name/id, shown while active or successful. */
  readonly containerId?: string;
  /** Process exit code, shown on failure. */
  readonly exitCode?: number;
}

const PRESENTATION: Readonly<
  Record<SandboxStatus, { emoji: string; label: string; className: string; dot: string; pulse: boolean }>
> = {
  idle: {
    emoji: '⚪',
    label: 'Sandbox ocioso',
    className: 'border-slate-700/60 bg-slate-900/70 text-slate-400',
    dot: 'bg-slate-500',
    pulse: false,
  },
  executing: {
    emoji: '⏳',
    label: 'Executando em Ambiente Isolado…',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
    pulse: true,
  },
  success: {
    emoji: '🟢',
    label: 'Docker Sandbox Active',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
    pulse: false,
  },
  error: {
    emoji: '🔴',
    label: 'Compilation Error',
    className: 'border-red-500/40 bg-red-500/10 text-red-300',
    dot: 'bg-red-400',
    pulse: false,
  },
};

/**
 * Render the status badge.
 */
export function StatusBadge({ status, image, containerId, exitCode }: StatusBadgeProps) {
  const view = PRESENTATION[status];

  const suffix =
    status === 'error'
      ? exitCode === undefined
        ? ''
        : ` (Exit Code ${exitCode})`
      : status === 'success' && image !== undefined
        ? containerId === undefined
          ? ` [Container: ${image}]`
          : ` [Container: ${image} · ${containerId}]`
        : '';

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[11px] ${view.className}`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${view.dot} ${view.pulse ? 'animate-pulse' : ''}`}
      />
      <span aria-hidden="true">{view.emoji}</span>
      <span>
        {view.label}
        {suffix}
      </span>
    </span>
  );
}
