---
description: "Lê stack trace, log de container ou saída de terminal e aponta a linha e a causa provável — usando os modos de falha que este app já teve"
name: "explain-error"
argument-hint: "cole o erro completo (traceback, exit code, log). Sem o texto exato, a resposta é chute"
agent: "ask"
---

Primeiro: **exija o texto exato.** Paráfrase de erro ("deu erro no docker") não tem
diagnóstico — o que identifica a causa é o número, a mensagem e a linha.

## Mapa de falhas reais deste projeto

Procure o sintoma aqui antes de teorizar. Todos estes aconteceram de verdade:

| Sintoma | Causa real | Onde |
| --- | --- | --- |
| `exitCode: 127` em **toda** chamada de tool no sandbox | `argv[0]` não é o binário: argv começava em `run`, então `spawn('run')` → `ENOENT` | `common/docker/` |
| `Permission denied` ao escrever no projeto, container `--cap-drop ALL` | rodando como **root** sem `CAP_DAC_OVERRIDE`; usar `--user uid:gid` e `HOME=/tmp` | `DockerSandbox` |
| Todo `execve` falha dentro do container | `no-new-privileges` neste kernel; `NEXUS_SANDBOX_NO_NEW_PRIVILEGES=0` desliga | sandbox |
| Janela "não está respondendo" no Linux (WebKitGTK) | comando Tauri **síncrono** fazendo trabalho bloqueante na main thread; precisa `async fn` + `spawn_blocking` | `src-tauri/src/main.rs` |
| Handshake MCP trava / resposta ilegível | `console.log` no core escreveu no `stdout`, que é o canal JSON-RPC | `common/**` |
| LSP dessincroniza depois de um arquivo com acento | `Content-Length` em **caracteres** em vez de **bytes** UTF-8 | `common/lsp/` |
| Tool responde `isError` sem o handler rodar | o SDK valida `inputSchema` **antes**: argumento inválido nunca chega no handler | MCP v2 |
| Teste passa no Linux e falha no CI (Windows) | `/` fixo, `file:///ws` literal, `C:\` | testes |
| `npm install` → `ERESOLVE` | TypeScript 7.x (o `typescript-eslint@8` exige `<6.1.0`) | `package.json` |
| App abre sem modelos / 401 | chave ou endpoint local; o modelo é escolha do usuário, não do código | `lib/coreClient.ts` |
| Turno "falhou" sem dizer o que deu certo | relato honesto de falhas do agente (#12) — se não mostra, é regressão | `agentLoop.ts` |
| Timeout curto demais num modelo local | orçamento do agente: passos e tempo; `0` = sem prazo | `App.tsx` ↔ `mcp.rs` |

## Método

1. **Localize a camada** — webview (React) · IPC Tauri (Rust) · core (MCP/TS) · tool
   (arquivo/docker/internet) · modelo. A camada decide quem pode estar errado.
2. **Estreite com um comando** — não com leitura de arquivo às cegas:
   `node dist/core.mjs` para ver o banner e o erro de boot; `npm run smoke` para a
   surface; `cd src-tauri/harness && cargo test` para o Rust sem Tauri.
3. **Causa** com a linha exata. Se você não consegue apontar linha, diga o que falta
   (log, `-vv`, exit code) em vez de listar cinco possibilidades.
4. **Fix mínimo** e o **comando que prova** que corrigiu.

## Entrega

```
linha:    <arquivo:linha>
causa:    <uma frase>
fix:      <a menor mudança>
prova:    <comando + resultado esperado>
```

Uma alternativa só se for igualmente provável — e diga o que a distinguiria. Não
reescreva o módulo para consertar uma linha.
