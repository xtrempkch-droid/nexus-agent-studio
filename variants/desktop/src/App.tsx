/**
 * Desktop application shell.
 *
 * Composes the header, explorer, editor, bottom panel (terminal / shell / diff)
 * and the agent chat panel, reproducing the `layout/` reference inside a real
 * React + Tailwind v4 build.
 *
 * NOTE ON WIRING: the core connection is **real**. `lib/shell.ts` reaches the
 * Tauri shell, and inside the packaged app the header badge reports what the
 * core actually negotiated rather than a hardcoded label; in a plain browser it
 * keeps saying "Simulação", because nothing was injected and pretending
 * otherwise would be a lie. The agent handlers further down are still a
 * deterministic simulation — moving them onto `callCoreTool` is the next step,
 * and until then this screen is part simulation on purpose.
 *
 * @module variants/desktop/src/App
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { InlineHint } from './lib/coreTypes.ts';
import { describeCore, isShellAvailable } from './lib/shell.ts';
import { AgentChat, type ChatMessage, type PendingApproval } from './components/AgentChat.tsx';
import {
  FileExplorer,
  type FileStatus,
  type WorkspaceFile,
} from './components/FileExplorer.tsx';
import { HeaderBar, type AgentMode, type ModelOption } from './components/HeaderBar.tsx';
import { Icon } from './components/Icon.tsx';
import { TerminalOutput, type TerminalLine } from './components/TerminalOutput.tsx';
import type { SandboxStatus } from './components/StatusBadge.tsx';

/** Which bottom panel is visible. */
type BottomTab = 'agent' | 'shell' | 'diff';

interface FileRecord extends WorkspaceFile {
  readonly content: string;
}

const MODELS: readonly ModelOption[] = [
  { id: 'demo-simulation', label: '⚡ Modo Simulação (sem Ollama)' },
  { id: 'qwen2.5-coder:14b', label: 'Qwen2.5-Coder 14B' },
  { id: 'deepseek-coder-v2:16b', label: 'DeepSeek-Coder-V2 16B' },
  { id: 'llama3.1:8b', label: 'Llama 3.1 8B Instruct' },
];

const INITIAL_FILES: readonly FileRecord[] = [
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
  const [files, setFiles] = useState<readonly FileRecord[]>(INITIAL_FILES);
  const [activeFile, setActiveFile] = useState<string>('src/main.py');
  const [openTabs, setOpenTabs] = useState<readonly string[]>(['src/main.py']);

  const [mode, setMode] = useState<AgentMode>('assisted');
  const [approveAll, setApproveAll] = useState(false);
  const [model, setModel] = useState<string>('demo-simulation');

  const [messages, setMessages] = useState<readonly ChatMessage[]>([
    {
      id: 'welcome',
      role: 'agent',
      text:
        'Sou seu assistente local. Posso refatorar código, criar arquivos e executar ' +
        'comandos no terminal isolado. Use o modo Assistido para aprovar cada ação.',
    },
  ]);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [busy, setBusy] = useState(false);

  const [terminalLines, setTerminalLines] = useState<readonly TerminalLine[]>([]);
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus>('idle');
  const [lastRun, setLastRun] = useState<{ image: string; containerId: string; exitCode: number } | null>(null);

  const [hints, setHints] = useState<readonly InlineHint[]>([]);
  const [bottomTab, setBottomTab] = useState<BottomTab>('agent');

  const [shellLines, setShellLines] = useState<readonly string[]>([]);
  const [shellDraft, setShellDraft] = useState('');
  const [diffText, setDiffText] = useState('Nenhuma alteração registrada nesta sessão.');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [connectionLabel, setConnectionLabel] = useState('Simulação');
  const [connectionDotClass, setConnectionDotClass] = useState('bg-amber-400');

  const currentFile = useMemo(
    () => files.find((file) => file.path === activeFile) ?? null,
    [files, activeFile],
  );

  const activeModelLabel = useMemo(
    () => MODELS.find((option) => option.id === model)?.label ?? model,
    [model],
  );

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

  const selectFile = useCallback((path: string) => {
    setActiveFile(path);
    setOpenTabs((previous) => (previous.includes(path) ? previous : [...previous, path]));
  }, []);

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

    describeCore()
      .then((description) => {
        if (cancelled) {
          return;
        }
        setConnectionLabel('Core conectado');
        setConnectionDotClass('bg-emerald-400');
        appendTerminal(line('system', `Core: ${description}`));
      })
      .catch((error: unknown) => {
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
  }, [appendTerminal]);

  const runPytest = useCallback(() => {
    setSandboxStatus('executing');
    appendTerminal(line('system', 'Executando em ambiente isolado...'));
    appendTerminal(line('stdout', '\u001b[33m$ pytest tests/test_main.py\u001b[0m'));

    globalThis.setTimeout(() => {
      appendTerminal(
        line('stdout', '\u001b[32mtest_main.py::TestDataProcessor::test_calculate_stats PASSED\u001b[0m [100%]'),
      );
      appendTerminal(line('stdout', '\u001b[1m\u001b[32m✓ 1 passed in 0.08s\u001b[0m'));
      setLastRun({ image: 'python:3.12-slim', containerId: 'nexus-a41f9c22', exitCode: 0 });
      setSandboxStatus('success');
      appendMessage({ role: 'agent', text: '✓ Refatoração concluída e testes validados no terminal.' });
    }, 900);
  }, [appendMessage, appendTerminal]);

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
      setShellLines((previous) => [...previous, `$ ${command}`, 'Comando executado no ambiente local.']);
      setShellDraft('');
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
        workspaceLabel="workspace / my-python-project"
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
          files={files}
          activeFile={activeFile}
          hints={hints}
          rootLabel="MY-PYTHON-PROJECT"
          onSelect={selectFile}
          onNewFile={() =>
            appendMessage({ role: 'system', text: 'Criação de arquivo disponível no app empacotado.' })
          }
          onRefresh={clearHints}
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
              onChange={(event) =>
                updateFile(activeFile, event.target.value, currentFile?.status ?? 'normal')
              }
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
                  {...(lastRun === null
                    ? {}
                    : {
                        image: lastRun.image,
                        containerId: lastRun.containerId,
                        exitCode: lastRun.exitCode,
                      })}
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
