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

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AgentProgressEvent, InlineHint } from './lib/coreTypes.ts';
import {
  describeCore,
  isShellAvailable,
  onAgentStream,
  pickFile,
  pickWorkspace,
  setWorkspace,
  workspaceInfo,
} from './lib/shell.ts';
import {
  askAgent,
  configureLanguageServer,
  getDiagnostics,
  listDirectory,
  listLanguageServers,
  listModels,
  readFile,
  runInSandbox,
  writeFile,
  type AgentTurnResult,
  type DirectoryEntry,
  type LanguageServerStatus,
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

/** What is needed to resume an agent turn paused for approval. */
interface AgentResumeState {
  readonly history: readonly unknown[];
  readonly assistantJson: string;
  readonly pendingTool: string;
  readonly pendingArguments: unknown;
}

/** Human-readable summary of a pending tool call. */
function describeApproval(tool: string, args: unknown): { target: string; description: string } {
  const obj = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>;
  const target =
    typeof obj['path'] === 'string'
      ? obj['path']
      : typeof obj['command'] === 'string'
        ? obj['command']
        : '';
  return { target, description: JSON.stringify(obj) };
}

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
  const [workspacePathDraft, setWorkspacePathDraft] = useState('');
  const [languageServers, setLanguageServers] = useState<readonly LanguageServerStatus[]>([]);
  const [newServerId, setNewServerId] = useState('typescript');
  const [newServerLanguages, setNewServerLanguages] = useState('typescript,typescriptreact');
  const [newServerCommand, setNewServerCommand] = useState('typescript-language-server');
  const [newServerArgs, setNewServerArgs] = useState('--stdio');

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

  /**
   * The message that is currently streaming the agent's answer, if any.
   *
   * Streaming progress arrives out-of-band over Tauri events while
   * `ask_agent` is still in flight, so the turn and the renderer are not in the
   * same call stack. A ref (rather than state) holds the id so the event handler
   * can update it without being recreated.
   */
  const streamingMessageId = useRef<string | null>(null);

  /** Append a "thinking" agent bubble that the stream will fill in. */
  const startStreamingMessage = useCallback(() => {
    const id = uid();
    streamingMessageId.current = id;
    setMessages((previous) => [...previous, { id, role: 'agent', text: '', thinking: true }]);
  }, []);

  /** Replace the streaming bubble's text with the latest full answer preview. */
  const applyStreamDelta = useCallback((text: string) => {
    const id = streamingMessageId.current;
    if (id === null) {
      return;
    }
    setMessages((previous) =>
      previous.map((message) =>
        message.id === id ? { ...message, text, thinking: false } : message,
      ),
    );
  }, []);

  /** Finalise the streaming bubble with the complete answer. */
  const finishStreamingMessage = useCallback((text: string) => {
    const id = streamingMessageId.current;
    streamingMessageId.current = null;
    setMessages((previous) =>
      previous.map((message) =>
        message.id === id ? { ...message, text, thinking: false } : message,
      ),
    );
  }, []);

  /** Remove the streaming bubble without replacing it (e.g. before an approval card). */
  const dropStreamingMessage = useCallback(() => {
    const id = streamingMessageId.current;
    streamingMessageId.current = null;
    if (id !== null) {
      setMessages((previous) => previous.filter((message) => message.id !== id));
    }
  }, []);

  const updateFile = useCallback((path: string, content: string, status: FileStatus) => {
    setFiles((previous) =>
      previous.map((file) => (file.path === path ? { ...file, content, status } : file)),
    );
  }, []);

  /** Replace the stored diagnostics for one file, keeping the other files'. */
  const mergeHints = useCallback((filePath: string, incoming: readonly InlineHint[]) => {
    setHints((previous) => [
      ...previous.filter((hint) => hint.filePath !== filePath),
      ...incoming,
    ]);
  }, []);

  /**
   * Ask the core for a file's diagnostics, refreshing it in its language server
   * first. This is the one path that brings diagnostics into the UI — compiler
   * output and language-server output share the core's hint store.
   */
  const checkDiagnostics = useCallback(
    (path: string, announce = false) => {
      if (!isShellAvailable()) {
        if (announce) {
          appendTerminal(
            line('stderr', 'O shell não está disponível — a verificação precisa do core.'),
          );
        }
        return;
      }
      if (path === '') {
        if (announce) {
          appendTerminal(line('system', 'Nenhum arquivo ativo para verificar.'));
        }
        return;
      }
      void getDiagnostics({ path, refresh: true })
        .then((result) => {
          mergeHints(result.path ?? path, result.diagnostics);
          if (announce && result.server === null) {
            appendTerminal(
              line('system', `Nenhum language server para ${path} — configure nas configurações.`),
            );
          }
        })
        .catch((error: unknown) => {
          if (announce) {
            appendTerminal(line('stderr', `Falha ao verificar ${path}: ${String(error)}`));
          }
        });
    },
    [appendTerminal, mergeHints],
  );

  /** Reload the language servers the core knows about. */
  const loadLanguageServers = useCallback(() => {
    if (!isShellAvailable()) {
      return;
    }
    void listLanguageServers()
      .then((result) => setLanguageServers(result.servers))
      .catch(() => undefined);
  }, []);

  /** Register a language server from the settings form. */
  const addLanguageServer = useCallback(() => {
    const id = newServerId.trim();
    const command = newServerCommand.trim();
    const languages = newServerLanguages
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    if (id === '' || command === '' || languages.length === 0) {
      return;
    }
    const args = newServerArgs
      .split(/\s+/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');

    void configureLanguageServer({
      id,
      languages,
      command,
      ...(args.length === 0 ? {} : { args }),
    })
      .then((result) => {
        setLanguageServers(result.configured);
        appendTerminal(
          line('system', `Language server "${id}" configurado (${languages.join(', ')}).`),
        );
      })
      .catch((error: unknown) => {
        appendTerminal(line('stderr', `Falha ao configurar o language server: ${String(error)}`));
      });
  }, [appendTerminal, newServerArgs, newServerCommand, newServerId, newServerLanguages]);

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
        .then((contents) => {
          updateFile(path, contents.content, 'normal');
          checkDiagnostics(path);
        })
        .catch((error: unknown) => {
          appendTerminal(line('stderr', `Falha ao ler ${path}: ${String(error)}`));
        });
    },
    [appendTerminal, checkDiagnostics, updateFile],
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
        checkDiagnostics(target.path);
      })
      .catch((error: unknown) => {
        appendTerminal(line('stderr', `Falha ao salvar ${target.path}: ${String(error)}`));
      });
  }, [activeFile, appendTerminal, checkDiagnostics, files, updateFile]);

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

  /**
   * Create an empty file in the current directory and open it.
   *
   * Named by the user through the explorer's inline prompt; the path is built
   * from the directory the explorer is showing, so the file lands where the user
   * is looking rather than at the workspace root.
   */
  const createFile = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed === '') {
        return;
      }
      if (!isShellAvailable()) {
        appendTerminal(line('stderr', 'O shell não está disponível — não é possível criar arquivos.'));
        return;
      }
      const path = currentDir === '.' ? trimmed : `${currentDir}/${trimmed}`;

      void writeFile(path, '')
        .then(() => {
          appendTerminal(line('system', `CREATE: ${path}`));
          void loadDirectory(currentDir);
          selectFile(path);
        })
        .catch((error: unknown) => {
          appendTerminal(line('stderr', `Falha ao criar ${path}: ${String(error)}`));
        });
    },
    [appendTerminal, currentDir, loadDirectory, selectFile],
  );

  const navigateUp = useCallback(() => {
    void loadDirectory(parentOf(currentDir));
  }, [currentDir, loadDirectory]);

  /**
   * Re-point the editor at a new workspace and reset every view that was scoped
   * to the old one: files, explorer, tabs, diagnostics, terminals and any
   * pending approval. The chat history is intentionally kept — it belongs to the
   * session, not to the project.
   */
  const applyWorkspace = useCallback(
    async (path: string) => {
      setWorkspaceLabel(path);
      setFiles([]);
      setEntries([]);
      setActiveFile('');
      setOpenTabs([]);
      setCurrentDir('.');
      setHints([]);
      setTerminalLines([]);
      setSandboxStatus('idle');
      setShellLines([]);
      setDiffText('Nenhuma alteração registrada nesta sessão.');
      setPendingApproval(null);
      resumeQueue.current.clear();
      appendTerminal(line('system', `Workspace: ${path}`));
      // The core restarts pointed at the new directory, so re-read its servers.
      loadLanguageServers();
      await loadDirectory('.');
    },
    [appendTerminal, loadDirectory, loadLanguageServers],
  );

  /** Open the native folder picker and switch to the chosen project. */
  const openWorkspace = useCallback(async () => {
    if (!isShellAvailable()) {
      appendTerminal(
        line('stderr', 'O shell não está disponível — escolha a pasta ao abrir o aplicativo.'),
      );
      return;
    }
    try {
      const path = await pickWorkspace();
      if (path !== null) {
        await applyWorkspace(path);
      }
    } catch (error) {
      appendTerminal(line('stderr', `Falha ao abrir projeto: ${String(error)}`));
    }
  }, [appendTerminal, applyWorkspace]);

  /**
   * Open the native file picker. The shell re-points the workspace at the file's
   * folder, so the file lands in the explorer and opens in the editor.
   */
  const openFile = useCallback(async () => {
    if (!isShellAvailable()) {
      appendTerminal(line('stderr', 'O shell não está disponível — abra um arquivo pelo sistema.'));
      return;
    }
    try {
      const result = await pickFile();
      if (result !== null) {
        const [workspace, file] = result;
        await applyWorkspace(workspace);
        selectFile(file);
      }
    } catch (error) {
      appendTerminal(line('stderr', `Falha ao abrir arquivo: ${String(error)}`));
    }
  }, [appendTerminal, applyWorkspace, selectFile]);

  /** Switch to a workspace typed by hand in the settings panel. */
  const applyManualWorkspace = useCallback(async () => {
    const path = workspacePathDraft.trim();
    if (path === '') {
      return;
    }
    try {
      const canonical = await setWorkspace(path);
      await applyWorkspace(canonical);
      setWorkspacePathDraft('');
    } catch (error) {
      appendTerminal(line('stderr', `Falha ao definir pasta: ${String(error)}`));
    }
  }, [appendTerminal, applyWorkspace, workspacePathDraft]);

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
      loadLanguageServers();
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
  }, [appendTerminal, loadDirectory, loadLanguageServers]);

  // Subscribe to the core's agent progress stream once, when the shell is
  // available. `answer_delta` fills the streaming bubble; `tool_call` surfaces
  // the tool names in the terminal as they happen instead of after the turn.
  useEffect(() => {
    if (!isShellAvailable()) {
      return undefined;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const handleProgress = (event: AgentProgressEvent) => {
      if (event.type === 'answer_delta') {
        applyStreamDelta(event.text);
      } else if (event.type === 'tool_call') {
        appendTerminal(line('system', `agente: ${event.tool}`));
      }
    };

    onAgentStream(handleProgress)
      .then((stop) => {
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch(() => {
        // No stream available; the turn still answers normally.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [appendTerminal, applyStreamDelta]);

  /** Log the tools a turn used, so the user sees what the agent did. */
  const finishTurn = useCallback(
    (turn: AgentTurnResult) => {
      setBusy(false);
      if (turn.toolCalls.length > 0) {
        setDiffText(
          ['Ferramentas usadas nesta tarefa:', ...turn.toolCalls.map((name) => `  ${name}`)].join(
            '\n',
          ),
        );
      }
      finishStreamingMessage(turn.answer);
    },
    [finishStreamingMessage],
  );

  const failTurn = useCallback(
    (error: unknown) => {
      setBusy(false);
      finishStreamingMessage(`Falha ao executar o agente: ${String(error)}`);
    },
    [finishStreamingMessage],
  );

  const resumeQueue = useRef(new Map<string, AgentResumeState>());

  /**
   * Run one agent step, resuming a paused turn when `options.resume` is given.
   *
   * In assisted mode the core pauses before `write_file` and
   * `run_terminal_command` and hands the decision back here; approving or
   * rejecting resumes the same conversation instead of starting over.
   */
  const runAgent = useCallback(
    async (options: { prompt?: string; resume?: AgentResumeState; decision?: 'approve' | 'reject' }) => {
      const provider = activeProvider;
      const modelName = activeModel;

      if (!isShellAvailable()) {
        failTurn(new Error('o shell não está disponível'));
        return;
      }
      if (provider === null || modelName === '') {
        failTurn(new Error('nenhum modelo selecionado — sincronize um provedor nas configurações'));
        return;
      }

      const base = { model: modelName, baseUrl: provider.baseUrl, kind: provider.kind };
      const effectiveMode = mode === 'assisted' && !approveAll ? 'assisted' : 'autonomous';

      try {
        const turn =
          options.resume === undefined
            ? await askAgent({ prompt: options.prompt ?? '', ...base, mode: effectiveMode })
            : await askAgent({
                ...base,
                mode: effectiveMode,
                history: options.resume.history,
                assistantJson: options.resume.assistantJson,
                pendingTool: options.resume.pendingTool,
                pendingArguments: options.resume.pendingArguments,
                decision: options.decision,
              });

        if (turn.status === 'needs_approval') {
          const id = uid();
          resumeQueue.current.set(id, {
            history: turn.history ?? [],
            assistantJson: turn.assistantJson ?? '',
            pendingTool: turn.tool ?? '',
            pendingArguments: turn.arguments,
          });
          const summary = describeApproval(turn.tool ?? '', turn.arguments);
          setPendingApproval({
            id,
            tool: turn.tool ?? '',
            target: summary.target,
            description: summary.description,
          });
          // The streaming bubble is replaced by the approval card, not by an
          // answer — the resumed turn gets its own bubble.
          dropStreamingMessage();
          appendMessage({
            role: 'agent',
            text: `Quero executar \`${turn.tool}\` — aprovar ou rejeitar?`,
          });
          setBusy(false);
          return;
        }

        finishTurn(turn);
      } catch (error) {
        failTurn(error);
      }
    },
    [activeModel, activeProvider, approveAll, dropStreamingMessage, failTurn, finishTurn, mode],
  );

  const handleSend = useCallback(
    (text: string) => {
      appendMessage({ role: 'user', text });
      startStreamingMessage();
      setBusy(true);
      void runAgent({ prompt: text });
    },
    [appendMessage, runAgent, startStreamingMessage],
  );

  const handleApprove = useCallback(
    (id: string) => {
      const resume = resumeQueue.current.get(id);
      resumeQueue.current.delete(id);
      setPendingApproval(null);
      if (resume === undefined) {
        return;
      }
      appendMessage({ role: 'system', text: 'Aprovado.' });
      startStreamingMessage();
      setBusy(true);
      void runAgent({ resume, decision: 'approve' });
    },
    [appendMessage, runAgent, startStreamingMessage],
  );

  const handleReject = useCallback(
    (id: string) => {
      const resume = resumeQueue.current.get(id);
      resumeQueue.current.delete(id);
      setPendingApproval(null);
      if (resume === undefined) {
        return;
      }
      appendMessage({ role: 'system', text: 'Rejeitado.' });
      startStreamingMessage();
      setBusy(true);
      void runAgent({ resume, decision: 'reject' });
    },
    [appendMessage, runAgent, startStreamingMessage],
  );

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

  const modelOptions = useMemo<readonly ModelOption[]>(
    () => syncedModels.map((name) => ({ id: name, label: name })),
    [syncedModels],
  );

  // The model is now free text, so the label is the typed value itself; the
  // synced list only feeds the autocomplete suggestions.
  const activeModelLabel = useMemo(
    () => (activeModel === '' ? 'sem modelo' : activeModel),
    [activeModel],
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
        onOpenWorkspace={() => void openWorkspace()}
        onOpenFile={() => void openFile()}
        onCheckDiagnostics={() => checkDiagnostics(activeFile, true)}
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
          onNewFile={createFile}
          onRefresh={() => {
            clearHints();
            void loadDirectory(currentDir);
          }}
          onOpenWorkspace={() => void openWorkspace()}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 p-5 pb-3">
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

            <div className="scrollbar-ide min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 text-xs">
              <div>
                <label htmlFor="workspace-path" className="mb-1 block font-medium text-slate-300">
                  Pasta do projeto:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="workspace-path"
                    value={workspacePathDraft}
                    onChange={(event) => setWorkspacePathDraft(event.target.value)}
                    placeholder={
                      workspaceLabel === 'sem workspace' ? '/caminho/do/projeto' : workspaceLabel
                    }
                    spellCheck={false}
                    autoComplete="off"
                    className="flex-1 rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void applyManualWorkspace()}
                    className="rounded border border-slate-700 bg-slate-800 px-3 py-2 font-medium text-slate-200 hover:bg-slate-700"
                  >
                    Abrir
                  </button>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  Digite o caminho de um projeto existente, ou use &ldquo;Abrir
                  projeto&rdquo; no topo para escolher pelo diálogo do sistema.
                </p>
              </div>

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

              <div>
                <label htmlFor="model-name" className="mb-1 block font-medium text-slate-300">
                  Modelo ativo (nome livre):
                </label>
                <input
                  id="model-name"
                  value={activeModel}
                  onChange={(event) => setActiveModel(event.target.value)}
                  placeholder="ex: qwen2.5:7b, gpt-4o, llama3.2"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  Digite qualquer modelo suportado pelo provedor. &ldquo;Sincronizar
                  modelos&rdquo; abaixo só preenche as sugestões — não é obrigatório.
                </p>
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
                    Modelos detectados — clique para usar:
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

              <div className="space-y-1.5 rounded border border-slate-800 bg-slate-950/40 p-2">
                <span className="font-medium text-slate-300">Servidores de linguagem (LSP)</span>
                <p className="text-[10px] leading-relaxed text-slate-500">
                  Um servidor por linguagem; ele inicia sozinho na primeira verificação.
                  Ex.: `typescript-language-server --stdio` para TypeScript.
                </p>

                {languageServers.length === 0 ? (
                  <p className="font-mono text-[10px] text-slate-500">Nenhum configurado.</p>
                ) : (
                  <div className="space-y-1">
                    {languageServers.map((server) => (
                      <div
                        key={server.id}
                        className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/60 px-2 py-1"
                      >
                        <span className="font-mono text-slate-300">
                          {server.id}
                          <span className="ml-1 text-[10px] text-slate-500">
                            ({server.languages.join(', ')} · {server.command})
                          </span>
                        </span>
                        <span
                          className={`text-[10px] ${
                            server.running ? 'text-emerald-400' : 'text-slate-500'
                          }`}
                        >
                          {server.running ? 'ativo' : 'parado'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  value={newServerId}
                  onChange={(event) => setNewServerId(event.target.value)}
                  placeholder="id (ex: typescript)"
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
                <input
                  value={newServerLanguages}
                  onChange={(event) => setNewServerLanguages(event.target.value)}
                  placeholder="linguagens (ex: typescript,typescriptreact)"
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
                <input
                  value={newServerCommand}
                  onChange={(event) => setNewServerCommand(event.target.value)}
                  placeholder="comando (ex: typescript-language-server)"
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
                <input
                  value={newServerArgs}
                  onChange={(event) => setNewServerArgs(event.target.value)}
                  placeholder="argumentos (ex: --stdio)"
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={addLanguageServer}
                  className="w-full rounded border border-slate-700 bg-slate-800 py-1.5 font-medium text-slate-200 hover:bg-slate-700"
                >
                  Adicionar servidor
                </button>
              </div>
            </div>

            <div className="flex shrink-0 justify-end border-t border-slate-800 p-5 pt-3">
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
