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
 * The **agent** half is still a deterministic simulation. There is no model
 * behind it: the chat replays a fixed script and the refactor it performs is
 * string substitution on the file it already had. Making that real needs an
 * actual LLM, which is its own slice — see `docs/PROJECT_STATE.md`.
 *
 * @module variants/desktop/src/App
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { InlineHint } from './lib/coreTypes.ts';
import { describeCore, isShellAvailable, workspaceInfo } from './lib/shell.ts';
import {
  listDirectory,
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

const MODELS: readonly ModelOption[] = [
  { id: 'demo-simulation', label: '⚡ Modo Simulação (sem Ollama)' },
  { id: 'qwen2.5-coder:14b', label: 'Qwen2.5-Coder 14B' },
  { id: 'deepseek-coder-v2:16b', label: 'DeepSeek-Coder-V2 16B' },
  { id: 'llama3.1:8b', label: 'Llama 3.1 8B Instruct' },
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
  const [model, setModel] = useState<string>('demo-simulation');

  const [messages, setMessages] = useState<readonly ChatMessage[]>([
    {
      id: 'welcome',
      role: 'agent',
      text:
        'Assistente em simulação: não há modelo conectado a esta janela, então o que eu ' +
        'responder é roteiro fixo, não raciocínio. O explorador, o editor e o shell falam ' +
        'com o core de verdade; o chat é a parte que falta.',
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
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [connectionLabel, setConnectionLabel] = useState('Simulação');
  const [connectionDotClass, setConnectionDotClass] = useState('bg-amber-400');
  const [workspaceLabel, setWorkspaceLabel] = useState('sem workspace');

  const currentFile = useMemo(
    () => files.find((file) => file.path === activeFile) ?? null,
    [files, activeFile],
  );

  const activeModelLabel = useMemo(
    () => MODELS.find((option) => option.id === model)?.label ?? model,
    [model],
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
   * Run the tests in the core's sandbox.
   *
   * This used to print a green "1 passed in 0.08s" unconditionally, which was
   * the most convincing lie in the app: it looked like evidence and was a
   * constant. What is shown now is whatever the sandbox returned, including its
   * refusal to run at all.
   */
  const runPytest = useCallback(() => {
    if (!isShellAvailable()) {
      appendTerminal(line('system', 'Pré-visualização: sem sandbox para executar testes.'));
      return;
    }

    setSandboxStatus('executing');
    appendTerminal(line('system', 'Executando em ambiente isolado...'));

    void runInSandbox('pytest -q')
      .then((run) => {
        if (run.stdout.trimEnd() !== '') {
          appendTerminal(line('stdout', run.stdout.trimEnd()));
        }
        if (run.stderr.trimEnd() !== '') {
          appendTerminal(line('stderr', run.stderr.trimEnd()));
        }
        appendTerminal(
          line('system', run.timedOut ? 'tempo esgotado' : `saída ${String(run.exitCode)}`),
        );
        setSandboxStatus(run.exitCode === 0 ? 'success' : 'error');
      })
      .catch((error: unknown) => {
        appendTerminal(line('stderr', String(error)));
        setSandboxStatus('error');
      });
  }, [appendTerminal]);

  const applyRefactor = useCallback(() => {
    const target = files.find((file) => file.path === 'src/main.py');
    if (target === undefined) {
      return;
    }

    const updated = target.content.replace(
      '        return {"mean": mean, "total": total}',
      [
        '        variance = sum((x - mean) ** 2 for x in values) / len(values)',
        '        return {',
        '            "mean": mean,',
        '            "std_dev": math.sqrt(variance),',
        '            "total": total,',
        '        }',
      ].join('\n'),
    );

    updateFile('src/main.py', updated, 'modified');
    selectFile('src/main.py');
    setDiffText(
      [
        '--- src/main.py',
        '+++ src/main.py',
        '+        variance = sum((x - mean) ** 2 for x in values) / len(values)',
        '+        return {',
        '+            "mean": mean,',
        '+            "std_dev": math.sqrt(variance),',
        '+            "total": total,',
        '+        }',
        '-        return {"mean": mean, "total": total}',
      ].join('\n'),
    );
    setBottomTab('diff');
    appendTerminal(line('system', 'WRITE: src/main.py atualizado com desvio padrão.'));
    runPytest();
  }, [appendTerminal, files, runPytest, selectFile, updateFile]);

  const handleSend = useCallback(
    (text: string) => {
      appendMessage({ role: 'user', text });
      setBusy(true);
      appendMessage({ role: 'agent', text: 'Analisando código do projeto e planejando ações...', thinking: true });

      globalThis.setTimeout(() => {
        setBusy(false);
        setMessages((previous) => previous.filter((message) => message.thinking !== true));

        const needsApproval = mode === 'assisted' && !approveAll;
        if (needsApproval) {
          setPendingApproval({
            id: uid(),
            tool: 'write_file',
            target: 'src/main.py',
            description: 'Adicionar método calculate_std_dev e rodar pytest tests/test_main.py.',
          });
          appendMessage({
            role: 'agent',
            text: 'Preciso da sua aprovação para editar `src/main.py` e executar os testes.',
          });
        } else {
          appendMessage({ role: 'agent', text: 'Executando em modo autônomo...' });
          applyRefactor();
        }
      }, 700);
    },
    [appendMessage, applyRefactor, approveAll, mode],
  );

  const handleApprove = useCallback(() => {
    setPendingApproval(null);
    appendMessage({ role: 'agent', text: 'Ação aprovada. Aplicando alteração...' });
    applyRefactor();
  }, [appendMessage, applyRefactor]);

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

  const testOllama = useCallback(async () => {
    try {
      const response = await fetch(`${ollamaUrl}/api/tags`);
      if (response.ok) {
        setConnectionLabel('Ollama Online');
        setConnectionDotClass('bg-emerald-400 animate-pulse');
      } else {
        setConnectionLabel('Ollama Offline');
        setConnectionDotClass('bg-red-400');
      }
    } catch {
      setConnectionLabel('Ollama Offline');
      setConnectionDotClass('bg-red-400');
    }
  }, [ollamaUrl]);

  const clearHints = useCallback(() => setHints([]), []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-ide-bg text-slate-200">
      <HeaderBar
        workspaceLabel={workspaceLabel}
        models={MODELS}
        selectedModel={model}
        onModelChange={setModel}
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
                <label htmlFor="ollama-url" className="mb-1 block font-medium text-slate-300">
                  URL do Servidor Ollama Local:
                </label>
                <input
                  id="ollama-url"
                  value={ollamaUrl}
                  onChange={(event) => setOllamaUrl(event.target.value)}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => void testOllama()}
                className="flex w-full items-center justify-center gap-2 rounded border border-slate-700 bg-slate-800 py-2 font-medium text-slate-200 hover:bg-slate-700"
              >
                <Icon name="wifi" className="h-3.5 w-3.5" />
                <span>Testar Conexão com Ollama</span>
              </button>
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
