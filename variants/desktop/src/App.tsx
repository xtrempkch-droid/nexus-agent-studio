/**
 * Desktop application shell.
 *
 * Composes the header, explorer, editor, bottom panel (terminal / shell / diff)
 * and the agent chat panel, reproducing the `layout/` reference inside a real
 * React + Tailwind v4 build.
 *
 * NOTE ON WIRING: the two halves are in different states on purpose.
 *
 * The **filesystem** half is real. Inside the packaged app the explorer, the
 * editor and the interactive shell all reach the core through
 * `lib/coreClient.ts`, so what you see is the actual contents of the workspace
 * the app was pointed at — including the header, which reports the resolved path
 * instead of a placeholder. In a plain browser nothing was injected, so the
 * preview files below are shown instead; that is a design preview, not a broken
 * app.
 *
 * The **agent** half now runs a real turn against the provider and model chosen
 * in the settings: the prompt goes to the model, the model may call the workspace
 * tools through the core, and its answer is what the user sees. Per-step approval
 * is not implemented yet, so the agent runs a task to completion.
 *
 * @module variants/desktop/src/App
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { InlineHint } from './lib/coreTypes.ts';
import { describeCore, isShellAvailable, workspaceInfo } from './lib/shell.ts';
import {
  askAgent,
  listDirectory,
  listModels,
  readFile,
  runInSandbox,
  writeFile,
  type DirectoryEntry,
} from './lib/coreClient.ts';
import { AgentChat, type ChatMessage, type PendingApproval } from './components/AgentChat.tsx';
import { FileExplorer, parentOf, type FileStatus } from './components/FileExplorer.tsx';
import { HeaderBar, type AgentMode, type ModelOption } from './components/HeaderBar.tsx';
import { Icon } from './components/Icon.tsx';
import { TerminalOutput, type TerminalLine } from './components/TerminalOutput.tsx';
import type { SandboxStatus } from './components/StatusBadge.tsx';

/** Which bottom panel is visible. */
type BottomTab = 'agent' | 'shell' | 'diff';

interface FileRecord {
  readonly path: string;
  readonly status: FileStatus;
  /** Kept from the design preview; the explorer now derives icons from the path. */
  readonly language?: string;
  readonly content: string;
}

/** An AI provider the settings panel can talk to. */
interface AiProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly kind: 'ollama' | 'openai';
}

const DEFAULT_PROVIDERS: readonly AiProvider[] = [
  { id: 'ollama-local', name: 'Ollama local', baseUrl: 'http://localhost:11434', kind: 'ollama' },
];

/**
 * Files shown when there is no core to ask — a plain browser running
 * `npm run dev:desktop`. They preview the layout and are not a workspace the app
 * can edit; the explorer only falls back to these outside the packaged app.
 */
const PREVIEW_FILES: readonly FileRecord[] = [
  {
    path: 'src/main.py',
    status: 'normal',
    language: 'python',
    content: [
      'import math',
      '',
      '',
      'class DataProcessor:',
      '    def __init__(self, name: str):',
      '        self.name = name',
      '        self.data = []',
      '',
      '    def calculate_stats(self, values: list) -> dict:',
      '        """Calcula estatisticas basicas."""',
      '        if not values:',
      '            return {"mean": 0, "total": 0}',
      '',
      '        total = sum(values)',
      '        mean = total / len(values)',
      '        return {"mean": mean, "total": total}',
      '',
      '',
      'if __name__ == "__main__":',
      '    processor = DataProcessor("Core")',
      '    print(processor.calculate_stats([10, 20, 30]))',
    ].join('\n'),
  },
  {
    path: 'src/utils.py',
    status: 'normal',
    language: 'python',
    content: [
      'def format_currency(value: float) -> str:',
      '    return f"R$ {value:,.2f}"',
      '',
      '',
      'def sanitize_string(text: str) -> str:',
      '    return text.strip().lower()',
    ].join('\n'),
  },
  {
    path: 'tests/test_main.py',
    status: 'normal',
    language: 'python',
    content: [
      'import unittest',
      'from src.main import DataProcessor',
      '',
      '',
      'class TestDataProcessor(unittest.TestCase):',
      '    def test_calculate_stats(self):',
      '        dp = DataProcessor("Test")',
      '        res = dp.calculate_stats([10, 20, 30])',
      '        self.assertEqual(res["mean"], 20)',
      '        self.assertEqual(res["total"], 60)',
      '',
      '',
      'if __name__ == "__main__":',
      '    unittest.main()',
    ].join('\n'),
  },
];

function uid(): string {
  return globalThis.crypto.randomUUID();
}

let lineSeq = 0;
function line(stream: TerminalLine['stream'], text: string): TerminalLine {
  lineSeq += 1;
  return { id: `line-${lineSeq}`, stream, text };
}

/**
 * Root component of the desktop variant.
 */
export default function App() {
  const [files, setFiles] = useState<readonly FileRecord[]>(PREVIEW_FILES);
  const [activeFile, setActiveFile] = useState<string>('src/main.py');
  const [openTabs, setOpenTabs] = useState<readonly string[]>(['src/main.py']);
  const [entries, setEntries] = useState<readonly DirectoryEntry[]>([]);
  const [currentDir, setCurrentDir] = useState<string>('.');

  const [mode, setMode] = useState<AgentMode>('assisted');
  const [approveAll, setApproveAll] = useState(false);
  const [activeModel, setActiveModel] = useState<string>('');

  const [messages, setMessages] = useState<readonly ChatMessage[]>([
    {
      id: 'welcome',
      role: 'agent',
      text:
        'Assistente conectado ao modelo escolhido nas configurações. Posso ler, ' +
        'escrever e listar arquivos e rodar comandos no terminal; o que eu responder ' +
        'vem do modelo, e as ferramentas que eu chamar aparecem no terminal.',
    },
  ]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [busy, setBusy] = useState(false);

  const [terminalLines, setTerminalLines] = useState<readonly TerminalLine[]>([]);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus>('idle');

  const [hints, setHints] = useState<readonly InlineHint[]>([]);
  const [bottomTab, setBottomTab] = useState<BottomTab>('agent');

  const [shellLines, setShellLines] = useState<readonly string[]>([]);
  const [shellDraft, setShellDraft] = useState('');
  const [diffText, setDiffText] = useState('Nenhuma alteração registrada nesta sessão.');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providers, setProviders] = useState<readonly AiProvider[]>(DEFAULT_PROVIDERS);
  const [activeProviderId, setActiveProviderId] = useState('ollama-local');
  const [syncedModels, setSyncedModels] = useState<readonly string[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderUrl, setNewProviderUrl] = useState('http://localhost:11434');
  const [newProviderKind, setNewProviderKind] = useState<'ollama' | 'openai'>('ollama');

  /** The provider whose models and settings are currently in use. */
  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === activeProviderId) ?? providers[0] ?? null,
    [activeProviderId, providers],
  );
  const [connectionLabel, setConnectionLabel] = useState('Simulação');
  const [connectionDotClass, setConnectionDotClass] = useState('bg-amber-400');
  const [workspaceLabel, setWorkspaceLabel] = useState('sem workspace');

  const currentFile = useMemo(
    () => files.find((file) => file.path === activeFile) ?? null,
    [files, activeFile],
  );

  /**
   * Short name of the workspace, for the explorer's tree root.
   *
   * The header carries the full path; the tree only has room for the leaf, and
   * showing a hardcoded name there made it impossible to tell which project was
   * open without reading the header.
   */
  const workspaceName = useMemo(() => {
    const trimmed = workspaceLabel.replace(/\/+$/u, '');
    const slash = trimmed.lastIndexOf('/');
    return (slash === -1 ? trimmed : trimmed.slice(slash + 1)).toUpperCase();
  }, [workspaceLabel]);

  /** Per-file statuses, flattened for the explorer's file rows. */
  const statuses = useMemo(() => {
    const map: Record<string, FileStatus> = {};
    for (const file of files) {
      map[file.path] = file.status;
    }
    return map;
  }, [files]);

  const appendTerminal = useCallback((...entries: TerminalLine[]) => {
    setTerminalLines((previous) => [...previous, ...entries]);
  }, []);

  const appendMessage = useCallback((message: Omit<ChatMessage, 'id'>) => {
    setMessages((previous) => [...previous, { ...message, id: uid() }]);
  }, []);

  const updateFile = useCallback((path: string, content: string, status: FileStatus) => {
    setFiles((previous) =>
      previous.map((file) => (file.path === path ? { ...file, content, status } : file)),
    );
  }, []);

  /**
   * Focus a file, reading it from the core the first time it is opened.
   *
   * Outside the shell the preview content is already in memory, so there is
   * nothing to fetch and nothing that can fail.
   */
  const selectFile = useCallback(
    (path: string) => {
      setActiveFile(path);
      setOpenTabs((previous) => (previous.includes(path) ? previous : [...previous, path]));

      // The explorer lists one directory at a time, so a freshly opened file may
      // not be in `files` yet. Give it a record first, or the editor has nowhere
      // to put the content it is about to read.
      setFiles((previous) =>
        previous.some((file) => file.path === path)
          ? previous
          : [...previous, { path, status: 'normal' as const, content: '' }],
      );

      if (!isShellAvailable()) {
        return;
      }

      void readFile(path)
        .then((contents) => updateFile(path, contents.content, 'normal'))
        .catch((error: unknown) => {
          appendTerminal(line('stderr', `Falha ao ler ${path}: ${String(error)}`));
        });
    },
    [appendTerminal, updateFile],
  );

  /**
   * Write the open file back through the core.
   *
   * Manual rather than on every keystroke: the core records each write in the
   * execution log as an AI-authored change, so saving per character would bury
   * the real edits in noise.
   */
  const saveActiveFile = useCallback(() => {
    const target = files.find((file) => file.path === activeFile);
    if (target === undefined || !isShellAvailable()) {
      return;
    }

    void writeFile(target.path, target.content)
      .then((outcome) => {
        updateFile(target.path, target.content, 'normal');
        appendTerminal(
          line('system', `WRITE: ${outcome.path} salvo (${String(outcome.bytesWritten)} bytes)`),
        );
      })
      .catch((error: unknown) => {
        appendTerminal(line('stderr', `Falha ao salvar ${target.path}: ${String(error)}`));
      });
  }, [activeFile, appendTerminal, files, updateFile]);

  /** List one directory and make it the explorer's current view. */
  const loadDirectory = useCallback(
    async (dir: string) => {
      setCurrentDir(dir);
      if (!isShellAvailable()) {
        return;
      }
      try {
        const listing = await listDirectory(dir, 1);
        setEntries(listing.entries);
      } catch (error) {
        appendTerminal(line('stderr', `Falha ao listar "${dir}": ${String(error)}`));
      }
    },
    [appendTerminal],
  );

  const openDirectory = useCallback(
    (path: string) => {
      void loadDirectory(path);
    },
    [loadDirectory],
  );

  const navigateUp = useCallback(() => {
    void loadDirectory(parentOf(currentDir));
  }, [currentDir, loadDirectory]);

  // Connect to the real core when running inside the desktop shell.
  //
  // In a plain browser nothing is injected, so the badge keeps saying
  // "Simulação" and the app stays honest about what it is. Inside the shell the
  // badge reports what the core actually negotiated instead of a hardcoded
  // string, which is the difference between a demo and a connected app.
  useEffect(() => {
    if (!isShellAvailable()) {
      return undefined;
    }

    let cancelled = false;

    const connect = async (): Promise<void> => {
      const description = await describeCore();
      if (cancelled) {
        return;
      }
      setConnectionLabel('Core conectado');
      setConnectionDotClass('bg-emerald-400');
      appendTerminal(line('system', `Core: ${description}`));

      const workspace = await workspaceInfo();
      if (cancelled) {
        return;
      }
      setWorkspaceLabel(workspace);
      appendTerminal(line('system', `Workspace: ${workspace}`));

      await loadDirectory('.');
    };

    void connect().catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      setConnectionLabel('Core indisponível');
      setConnectionDotClass('bg-red-500');
      appendTerminal(line('stderr', `Falha ao falar com o core: ${String(error)}`));
    });

    return () => {
      cancelled = true;
    };
  }, [appendTerminal, loadDirectory]);

  /**
   * Run one agent turn against the selected provider and model.
   *
   * This replaced the fixed-script chat. The prompt goes to the model, the model
   * may call the workspace tools through the core, and its answer is what the
   * user sees. No model selected is an ordinary state, reported plainly instead
   * of faked.
   */
  const handleSend = useCallback(
    (text: string) => {
      appendMessage({ role: 'user', text });
      setBusy(true);

      const provider = activeProvider;
      const modelName = activeModel;
      if (!isShellAvailable() || provider === null || modelName === '') {
        setBusy(false);
        appendMessage({
          role: 'agent',
          text: 'Nenhum modelo selecionado. Abra as configurações e sincronize um provedor.',
        });
        return;
      }

      void askAgent({ prompt: text, model: modelName, baseUrl: provider.baseUrl, kind: provider.kind })
        .then((turn) => {
          setBusy(false);
          if (turn.toolCalls.length > 0) {
            appendTerminal(line('system', `agente chamou: ${turn.toolCalls.join(', ')}`));
            setDiffText(
              [
                'Ferramentas usadas nesta tarefa:',
                ...turn.toolCalls.map((name) => `  ${name}`),
              ].join('\n'),
            );
          }
          appendMessage({ role: 'agent', text: turn.answer });
        })
        .catch((error: unknown) => {
          setBusy(false);
          appendMessage({ role: 'agent', text: `Falha ao executar o agente: ${String(error)}` });
        });
    },
    [activeModel, activeProvider, appendMessage, appendTerminal],
  );

  const handleApprove = useCallback(() => {
    setPendingApproval(null);
    appendMessage({
      role: 'system',
      text: 'Aprovação passo a passo ainda não está disponível: o agente executa a tarefa por inteiro.',
    });
  }, [appendMessage]);

  const handleReject = useCallback(() => {
    setPendingApproval(null);
    appendMessage({ role: 'system', text: 'Ação rejeitada pelo usuário.' });
  }, [appendMessage]);

  const handleShellSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const command = shellDraft.trim();
      if (command === '') {
        return;
      }

      setShellDraft('');
      setShellLines((previous) => [...previous, `$ ${command}`]);

      if (!isShellAvailable()) {
        setShellLines((previous) => [
          ...previous,
          'Pré-visualização: sem o app empacotado não há sandbox para executar.',
        ]);
        return;
      }

      const appendOutput = (text: string): void => {
        const trimmed = text.trimEnd();
        if (trimmed !== '') {
          setShellLines((previous) => [...previous, ...trimmed.split('\n')]);
        }
      };

      setSandboxStatus('executing');
      void runInSandbox(command)
        .then((run) => {
          appendOutput(run.stdout);
          appendOutput(run.stderr);
          appendOutput(run.timedOut ? '(tempo esgotado)' : `(saída ${String(run.exitCode)})`);
          setSandboxStatus(run.exitCode === 0 ? 'success' : 'error');
        })
        .catch((error: unknown) => {
          appendOutput(String(error));
          setSandboxStatus('error');
        });
    },
    [shellDraft],
  );

  /** Ask the active provider which models it exposes, so the user can choose one. */
  const syncModels = useCallback(async () => {
    if (activeProvider === null) {
      return;
    }
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await listModels(activeProvider.kind, activeProvider.baseUrl);
      setSyncedModels(result.models);
      setActiveModel((previous) =>
        previous === '' || !result.models.includes(previous)
          ? (result.models[0] ?? '')
          : previous,
      );
      setConnectionLabel(`${activeProvider.name}: ${String(result.count)} modelo(s)`);
      setConnectionDotClass('bg-emerald-400');
    } catch (error) {
      setSyncError(String(error));
      setConnectionLabel('IA offline');
      setConnectionDotClass('bg-red-400');
    } finally {
      setSyncing(false);
    }
  }, [activeProvider]);

  const addProvider = useCallback(() => {
    const name = newProviderName.trim();
    const url = newProviderUrl.trim();
    if (name === '' || url === '') {
      return;
    }
    const provider: AiProvider = { id: uid(), name, baseUrl: url, kind: newProviderKind };
    setProviders((previous) => [...previous, provider]);
    setActiveProviderId(provider.id);
    setSyncedModels([]);
    setNewProviderName('');
  }, [newProviderKind, newProviderName, newProviderUrl]);

  const removeProvider = useCallback(
    (id: string) => {
      if (providers.length === 1) {
        return;
      }
      const remaining = providers.filter((provider) => provider.id !== id);
      setProviders(remaining);
      if (id === activeProviderId) {
        setActiveProviderId(remaining[0]?.id ?? 'ollama-local');
      }
    },
    [activeProviderId, providers],
  );

  const modelOptions = useMemo<readonly ModelOption[]>(() => {
    if (syncedModels.length === 0) {
      return [{ id: '', label: 'Sincronize um provedor' }];
    }
    return syncedModels.map((name) => ({ id: name, label: name }));
  }, [syncedModels]);

  const activeModelLabel = useMemo(
    () => modelOptions.find((option) => option.id === activeModel)?.label ?? activeModel,
    [modelOptions, activeModel],
  );

  const clearHints = useCallback(() => setHints([]), []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ide-bg text-slate-200">
      <HeaderBar
        workspaceLabel={workspaceLabel}
        models={modelOptions}
        selectedModel={activeModel}
        onModelChange={setActiveModel}
        mode={mode}
        onModeChange={setMode}
        connectionLabel={connectionLabel}
        connectionDotClass={connectionDotClass}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="relative flex flex-1 overflow-hidden">
        <FileExplorer
          entries={entries}
          activeFile={activeFile}
          currentDir={currentDir}
          hints={hints}
          statuses={statuses}
          rootLabel={workspaceName}
          onOpenFile={selectFile}
          onOpenDirectory={openDirectory}
          onNavigateUp={navigateUp}
          onNewFile={() =>
            appendMessage({ role: 'system', text: 'Criação de arquivo ainda não está disponível.' })
          }
          onRefresh={() => {
            clearHints();
            void loadDirectory(currentDir);
          }}
        />

        <main className="flex min-w-0 flex-1 flex-col border-r border-slate-800/80 bg-ide-editor">
          <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-800/80 bg-ide-sidebar px-2 font-mono text-xs">
            {openTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveFile(tab)}
                className={`flex items-center gap-2 rounded-t border-r border-slate-800/60 px-3 py-1.5 ${
                  tab === activeFile
                    ? 'border-t-2 border-indigo-500 bg-ide-editor text-slate-100'
                    : 'bg-slate-900/40 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>{tab}</span>
              </button>
            ))}
          </div>

          <div className="relative min-h-0 flex-1 bg-slate-950/80">
            <textarea
              value={currentFile?.content ?? ''}
              onChange={(event) => updateFile(activeFile, event.target.value, 'modified')}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                  event.preventDefault();
                  saveActiveFile();
                }
              }}
              spellCheck={false}
              className="scrollbar-ide h-full w-full resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed text-slate-200 focus:outline-none"
              aria-label={`Editor: ${activeFile}`}
            />
          </div>

          <div className="flex h-48 shrink-0 flex-col border-t border-slate-800/80">
            <div className="flex h-8 shrink-0 items-center gap-4 border-b border-slate-800/80 bg-ide-sidebar px-3 font-mono text-xs text-slate-400">
              {(
                [
                  ['agent', 'terminal', 'Terminal do Agente'],
                  ['shell', 'square-terminal', 'Shell Interativo'],
                  ['diff', 'file-diff', 'Inspeção de Alterações'],
                ] as const
              ).map(([id, icon, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBottomTab(id)}
                  className={
                    bottomTab === id
                      ? 'flex items-center gap-1.5 border-b-2 border-indigo-500 pt-1 pb-1 font-medium text-indigo-400'
                      : 'flex items-center gap-1.5 pt-1 pb-1 hover:text-slate-200'
                  }
                >
                  <Icon name={icon} className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1">
              {bottomTab === 'agent' && (
                <TerminalOutput
                  lines={terminalLines}
                  status={sandboxStatus}
                  onClear={() => setTerminalLines([])}
                />
              )}

              {bottomTab === 'shell' && (
                <div className="flex h-full flex-col justify-between bg-slate-950 p-3 font-mono text-xs">
                  <div className="scrollbar-ide flex-1 space-y-1 overflow-y-auto text-slate-300">
                    {shellLines.length === 0 ? (
                      <div className="text-slate-500">Nexus Interactive Shell v1.0</div>
                    ) : (
                      shellLines.map((entry, index) => (
                        <div key={`shell-${index}`} className="whitespace-pre-wrap">
                          {entry}
                        </div>
                      ))
                    )}
                  </div>
                  <form onSubmit={handleShellSubmit} className="mt-2 flex items-center gap-2">
                    <span className="text-indigo-400">$</span>
                    <input
                      value={shellDraft}
                      onChange={(event) => setShellDraft(event.target.value)}
                      placeholder="ex: pytest, python src/main.py, ls"
                      className="flex-1 rounded border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </form>
                </div>
              )}

              {bottomTab === 'diff' && (
                <div className="scrollbar-ide h-full overflow-y-auto bg-slate-950 p-3 font-mono text-xs">
                  {diffText.split('\n').map((row, index) => {
                    const className = row.startsWith('+')
                      ? 'diff-added'
                      : row.startsWith('-')
                        ? 'diff-removed'
                        : '';
                    return (
                      <div key={`diff-${index}`} className={`whitespace-pre px-1 ${className}`}>
                        {row}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </main>

        <AgentChat
          messages={messages}
          pendingApproval={pendingApproval}
          approveAll={approveAll}
          busy={busy}
          activeModelLabel={activeModelLabel}
          onSend={handleSend}
          onApprove={handleApprove}
          onReject={handleReject}
          onToggleApproveAll={() => setApproveAll((previous) => !previous)}
        />
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Icon name="settings" className="h-4 w-4 text-indigo-400" />
                <span>Configurações do Servidor Local &amp; IA</span>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-200"
                aria-label="Fechar"
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="provider-select" className="mb-1 block font-medium text-slate-300">
                  Provedor de IA:
                </label>
                <select
                  id="provider-select"
                  value={activeProviderId}
                  onChange={(event) => {
                    setActiveProviderId(event.target.value);
                    setSyncedModels([]);
                  }}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-slate-200 focus:border-indigo-500 focus:outline-none"
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name} — {provider.baseUrl}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                {providers.map((provider) => (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/60 px-2 py-1"
                  >
                    <span className="font-mono text-slate-300">
                      {provider.name}
                      <span className="ml-1 text-[10px] text-slate-500">
                        ({provider.kind} · {provider.baseUrl})
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeProvider(provider.id)}
                      disabled={providers.length === 1}
                      title="Remover provedor"
                      className="text-slate-500 hover:text-red-400 disabled:opacity-30"
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5 rounded border border-slate-800 bg-slate-950/40 p-2">
                <span className="font-medium text-slate-300">Adicionar provedor</span>
                <input
                  value={newProviderName}
                  onChange={(event) => setNewProviderName(event.target.value)}
                  placeholder="Nome (ex: Meu servidor)"
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
                <input
                  value={newProviderUrl}
                  onChange={(event) => setNewProviderUrl(event.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <select
                    value={newProviderKind}
                    onChange={(event) =>
                      setNewProviderKind(event.target.value as 'ollama' | 'openai')
                    }
                    className="rounded border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="ollama">Ollama</option>
                    <option value="openai">OpenAI-compatível</option>
                  </select>
                  <button
                    type="button"
                    onClick={addProvider}
                    className="flex-1 rounded border border-slate-700 bg-slate-800 py-1.5 font-medium text-slate-200 hover:bg-slate-700"
                  >
                    Adicionar
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void syncModels()}
                disabled={syncing}
                className="flex w-full items-center justify-center gap-2 rounded border border-slate-700 bg-slate-800 py-2 font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              >
                <Icon name="refresh" className="h-3.5 w-3.5" />
                <span>{syncing ? 'Sincronizando…' : 'Sincronizar modelos'}</span>
              </button>

              {syncError !== null && (
                <p className="rounded border border-red-500/30 bg-red-500/10 p-2 text-red-300">
                  {syncError}
                </p>
              )}

              {syncedModels.length > 0 && (
                <div className="space-y-1">
                  <span className="font-medium text-slate-300">
                    Modelos disponíveis — escolha o ativo:
                  </span>
                  {syncedModels.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setActiveModel(name)}
                      className={`flex w-full items-center justify-between rounded border px-2 py-1.5 font-mono text-left ${
                        activeModel === name
                          ? 'border-indigo-500 bg-indigo-950/60 text-indigo-300'
                          : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <span>{name}</span>
                      {activeModel === name && <Icon name="check" className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
              >
                Salvar e Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
