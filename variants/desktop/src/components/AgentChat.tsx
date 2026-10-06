/**
 * AI agent chat panel.
 *
 * Mirrors the reference layout: a message history, an inline approval card shown
 * while the agent is in *assisted* mode, and a prompt composer (Enter sends,
 * Shift+Enter inserts a newline).
 *
 * @module variants/desktop/src/components/AgentChat
 */

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from './Icon.tsx';

/** Author of a chat message. */
export type ChatRole = 'user' | 'agent' | 'system';

/** A rendered chat message. */
export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly text: string;
  /** When true, renders a spinner instead of the author avatar. */
  readonly thinking?: boolean;
}

/** An action awaiting human approval. */
export interface PendingApproval {
  readonly id: string;
  /** MCP tool that would run, e.g. `write_file`. */
  readonly tool: string;
  /** Where the action applies, e.g. `src/main.py`. */
  readonly target: string;
  readonly description: string;
}

/** Props accepted by {@link AgentChat}. */
export interface AgentChatProps {
  readonly messages: readonly ChatMessage[];
  readonly pendingApproval: PendingApproval | null;
  /** True when "approve all this session" is active. */
  readonly approveAll: boolean;
  /** True while the agent is processing. */
  readonly busy: boolean;
  readonly activeModelLabel: string;
  readonly onSend: (text: string) => void;
  readonly onApprove: (id: string) => void;
  readonly onReject: (id: string) => void;
  readonly onToggleApproveAll: () => void;
}

function MessageBubble({ message }: { readonly message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="rounded-lg border border-indigo-800/40 bg-indigo-950/40 p-3 leading-relaxed text-slate-200">
        <div className="mb-1 flex items-center gap-2 font-semibold text-indigo-300">
          <Icon name="user" className="h-3.5 w-3.5" />
          <span>Você</span>
        </div>
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>
    );
  }

  if (message.role === 'system') {
    return (
      <div className="px-1 font-mono text-[11px] italic text-slate-500">{message.text}</div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 leading-relaxed text-slate-300">
      <div className="mb-1.5 flex items-center gap-2 font-semibold text-indigo-400">
        <Icon
          name={message.thinking === true ? 'loader' : 'bot'}
          className={`h-4 w-4 ${message.thinking === true ? 'animate-spin' : ''}`}
        />
        <span>Nexus Assistant</span>
      </div>
      <p className="whitespace-pre-wrap">{message.text}</p>
    </div>
  );
}

/**
 * Render the agent chat panel.
 */
export function AgentChat({
  messages,
  pendingApproval,
  approveAll,
  busy,
  activeModelLabel,
  onSend,
  onApprove,
  onReject,
  onToggleApproveAll,
}: AgentChatProps) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  // Seconds since the turn started. A local model on CPU can take a while, and
  // without a counter the wait is indistinguishable from a freeze.
  const [waitSeconds, setWaitSeconds] = useState(0);

  useEffect(() => {
    if (!busy) {
      setWaitSeconds(0);
      return undefined;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      setWaitSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node !== null) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, pendingApproval]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === '' || busy) {
      return;
    }
    onSend(text);
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const text = draft.trim();
      if (text !== '' && !busy) {
        onSend(text);
        setDraft('');
      }
    }
  };

  return (
    <aside className="flex w-96 shrink-0 flex-col bg-ide-sidebar">
      <div className="flex items-center justify-between border-b border-slate-800/80 px-3 py-2.5 text-xs">
        <div className="flex items-center gap-2 font-medium text-slate-200">
          <Icon name="sparkles" className="h-4 w-4 text-indigo-400" />
          <span>Agente Autônomo de IA</span>
        </div>
        <button
          type="button"
          onClick={onToggleApproveAll}
          className={`rounded border px-2 py-0.5 text-[10px] transition-colors ${
            approveAll
              ? 'border-emerald-400 bg-emerald-600 font-bold text-white'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
          }`}
        >
          {approveAll ? '✓ Aprovação Automática Ativa' : 'Aprovar Tudo nesta Sessão'}
        </button>
      </div>

      <div ref={scrollRef} className="scrollbar-ide flex-1 space-y-3 overflow-y-auto p-3 text-xs">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {pendingApproval !== null && (
          <div className="glow-indigo my-2 space-y-2 rounded-lg border border-indigo-500/40 bg-slate-900/90 p-3">
            <div className="flex items-center justify-between font-mono text-[11px] text-indigo-300">
              <span className="flex items-center gap-1.5">
                <Icon name="shield-alert" className="h-3.5 w-3.5" />
                {pendingApproval.tool}: {pendingApproval.target}
              </span>
              <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300">
                Aprovação Pendente
              </span>
            </div>

            <div className="rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[11px] text-slate-300">
              {pendingApproval.description}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => onApprove(pendingApproval.id)}
                className="flex flex-1 items-center justify-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
              >
                <Icon name="check" className="h-3.5 w-3.5" />
                Aprovar Ação
              </button>
              <button
                type="button"
                onClick={() => onReject(pendingApproval.id)}
                className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
              >
                Rejeitar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-800/80 bg-slate-900/50 p-3">
        {busy && (
          <div className="mb-2 flex items-center gap-2 rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 font-mono text-[10px] text-indigo-300">
            <Icon name="loader" className="h-3 w-3 animate-spin" />
            <span>Aguardando o modelo responder… {waitSeconds}s</span>
          </div>
        )}
        <form onSubmit={submit} className="relative">
          <label className="sr-only" htmlFor="agent-prompt">
            Instrução para o agente
          </label>
          <textarea
            id="agent-prompt"
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Descreva a instrução para o Agente..."
            className="w-full resize-none rounded-lg border border-slate-800 bg-slate-950 p-2.5 pr-10 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            title="Enviar para a IA"
            className="absolute right-2 bottom-3 rounded-md bg-indigo-600 p-1.5 text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon name="send" className="h-3.5 w-3.5" />
          </button>
        </form>

        <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-slate-500">
          <span>Enter envia · Shift+Enter quebra linha</span>
          <span className="text-indigo-400">{activeModelLabel}</span>
        </div>
      </div>
    </aside>
  );
}
