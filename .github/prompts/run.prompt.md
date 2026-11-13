---
description: "Compila, sobe e exercita o projeto de verdade antes de declarar concluído — não só 'os testes passaram'"
name: "run"
argument-hint: "o que exercitar (vazio = core + UI desktop)"
agent: "agent"
---

`/verify` prova que os comandos passam. `/run` prova que **a coisa funciona**. A
diferença aparece justamente nos bugs que este projeto já teve: lint, typecheck e 300
testes verdes com o sandbox saindo `127` em toda chamada, e com a janela congelando
porque um comando síncrono bloqueava a main thread.

## 1. Construir

```bash
npm run build            # dist/core.mjs
npm run build:desktop    # bundle da UI (Vite + Tailwind v4)
```

## 2. Subir o core e exercitá-lo como processo real

```bash
npm run smoke            # sobe dist/core.mjs e dirige com cliente MCP real
```

O que o smoke cobre hoje: handshake, `tools/list` com **16 tools**, leitura de
arquivo, recusa de caminho com `../`, recusa de chamada sem argumento obrigatório
(antes do handler), `edit_file` recusando snippet ausente, `recall_project_memory`, e
`web_fetch` explicando que o acesso está desligado. Ele **não** cobre UI, LSP nem
Docker.

Sonda manual do core, se precisar de algo fora do smoke:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  | node dist/core.mjs
```

O banner de inicialização vai para `stderr` (web ligada/desligada, sandbox), e
`stdout` só carrega JSON-RPC — se aparecer texto em `stdout`, isso é o bug.

## 3. Subir a UI

```bash
npm run dev:desktop -- --port 5199 --strictPort > /home/$USER/vite.log 2>&1 &
sleep 5; curl -s -o /dev/null -w "http %{http_code}\n" http://localhost:5199/
```

E renderizar de verdade (sem instalar nada):

```bash
sh .github/skills/playwright-browser/scripts/ui-shot.sh http://localhost:5199/ /home/$USER/ui-run.png
sh .github/skills/playwright-browser/scripts/ui-shot.sh http://localhost:5199/ /home/$USER/ui-run.html dom
```

Sem a ponte Tauri a UI **renderiza** (abas, layout, estados vazios) mas não abre
projeto/arquivo. Diga o que foi exercitado e o que não foi — não converta "renderizou"
em "funciona".

**Mate só o seu PID** (nunca `pkill` por nome: há outros servidores na máquina) e
limpe o PNG, o HTML e o log.

## 4. Rust, quando aplicável

```bash
cd src-tauri/harness && cargo test     # bridge.rs / mcp.rs / worker.rs, ~2,5 s
```

O `cargo check` do `main.rs` completo exige GTK/WebKitGTK e fica para o workflow
`tauri`. Não afirme que rodou.

## Relatório

| Etapa | Comando | Resultado |
| --- | --- | --- |
| build | `npm run build` | `dist/core.mjs` gerado |
| core | `npm run smoke` | 16 tools, todas as asserções |
| UI | shot + dom | renderizou; 4 abas presentes; **não** abre arquivo sem o shell |

Mais: o que **não** foi exercitado (Docker real, LSP com servidor instalado, janela
Tauri empacotada) e qual seria o comando. Se um passo falhou, o relatório é o da
falha — não o da intenção.
