---
description: "Explica um arquivo, módulo ou repositório inteiro em no máximo três tópicos curtos — sem virar aula"
name: "explain-brief"
argument-hint: "arquivo, símbolo ou 'o projeto' (vazio = o arquivo em foco no editor)"
agent: "ask"
---

Responda com **no máximo três tópicos**, cada um com **uma frase** (≤ 25 palavras), na
ordem: (1) o que este código **faz**, (2) o mecanismo que carrega o peso, (3) o que
quebra se alguém mexer errado. Depois, uma linha: **ler primeiro:** `arquivo:linha`.

Nada de: histórico, comparação com outras linguagens, lista de dependências, "vale
notar que", seção de conclusão.

Se o código for grande demais para três tópicos honestos, responda:

> Não cabe em três tópicos. O peso está em `X` (ler de `linha` a `linha`).

e pare. Inventar um resumo de 3 tópicos de um módulo de 470 linhas é pior que dizer
que não dá.

## Onde olhar para cada alvo deste repositório

| Alvo | O que é o mecanismo de verdade |
| --- | --- |
| `common/core.ts` | o registro de tools + o que cada opção de `CoreOptions` liga |
| `common/index.ts` | `serveStdio(() => server)` — factory, e `stdout` é JSON-RPC |
| `common/agent/agentLoop.ts` | o ciclo modelo → tool → modelo, com orçamento de passos |
| `common/lsp/` | framing `Content-Length` em bytes + `LanguageServerManager` |
| `common/web/fetchPolicy.ts` | o que é recusado **antes** de abrir a conexão |
| `src-tauri/src/worker.rs` | uma thread, FIFO, nada preso durante a chamada |
| `src-tauri/src/mcp.rs` | `tool_timeout`: ausente = 600 s, `Some(0)` = sem prazo |
| `variants/desktop/src/lib/shell.ts` | o único ponto que conhece os comandos Tauri |
| `variants/desktop/src/App.tsx` | 1.844 linhas: abas, settings, editor, agente |

Se o alvo não estiver na tabela, descubra o mecanismo lendo o arquivo — **não**
descreva o diretório.
