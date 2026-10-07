# AGENTS.md

Instruções para **qualquer agente de IA** que trabalhe neste repositório (GitHub
Copilot coding agent, CLI, IDE). Leia também `docs/PROJECT_STATE.md` — é o
arquivo de rastro que diz o que já foi feito, o que está bloqueado e qual é o
próximo passo.

## Regra nº 1 — não invente APIs

Antes de escrever código que use qualquer API externa:

1. Consulte a **documentação oficial** da versão que o `package.json` declara.
2. Confirme a assinatura real (nome do pacote, subpath, formato do argumento, retorno).
3. Se não conseguir confirmar, **emita `VERIFICATION REQUIRED: <api>`** e não
   fabrique a assinatura.

Isso já evitou erros reais neste repositório: o prompt original pedia React 20 e
Tailwind 5 (não existem) e `serveStdio(server)` (recebe uma **factory**). A lista
completa de correções está em `docs/PROJECT_STATE.md` §6.

## Stack verificada (2026-10-05) — não altere sem verificar de novo

| Dependência | Versão | Observação |
| --- | --- | --- |
| `@modelcontextprotocol/server` | `^2.3.1` | v2 estável, spec `2026-07-28`, Apache-2.0, `node >= 20` |
| `@modelcontextprotocol/client` | `^2.3.1` | cliente v2 |
| `@modelcontextprotocol/core` | `^2.3.1` | par obrigatório do `server` |
| `@modelcontextprotocol/sdk` | — | **v1 legado. NÃO USAR.** |
| `zod` | `^4.6.5` | `import * as z from 'zod/v4'` |
| `react` / `react-dom` | `^19.3.0` | **não existe React 20** |
| `tailwindcss` | `^4.3.3` | CSS-first `@theme`, sem `tailwind.config.js` |
| `typescript` | `~6.0.2` | **NÃO suba para 7.x** — `typescript-eslint@8` exige `>=4.8.4 <6.1.0`; TS 7 faz o `npm install` falhar com ERESOLVE. `baseUrl` é proibido (deprecado) |
| `vite` / `vitest` / `eslint` | `^8.3.2` / `^5.0.3` / `^10.12.0` | |
| Node.js | `>=22` | CI: 22 (LTS), 24 (Active LTS) |
| `tauri` (crate Rust) | `"2"` → **2.12.1** | faixa major-only de propósito: `tauri-build` é versionado **à parte** (2.7.1 no momento), então fixar os dois em versões exatas arriscaria um par incompatível. O Cargo rejeita combinações inválidas em vez de compilar algo errado. |
| `tauri-plugin-dialog` (crate Rust) | `"2"` | Diálogo nativo de pasta para "abrir projeto". Chamado **do Rust** (`DialogExt`/`FilePath`), **não** do webview — por isso não há dependência npm equivalente e nada muda no `package-lock.json`. |
| `@tauri-apps/cli` / `@tauri-apps/api` | **2.12.1** | **Ainda não entram como devDependency:** adicionar uma dep invalida o `package-lock.json` e faz o `npm ci` falhar. Adicione junto com um lockfile regenerado (`npm install --package-lock-only` local ou o workflow `bootstrap-lockfile`). O `cargo check` atual não precisa do CLI. |

### Padrões obrigatórios do MCP v2

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'x', version: '1.0.0' }); // 2º arg opcional: { maxToolInputElements }
server.registerTool('name', { description: '...', inputSchema: z.object({} ) }, async (args) => {
  return { content: [{ type: 'text', text: '...' }] };
});
serveStdio(() => server); // recebe uma FACTORY, retorna StdioServerHandle
```

- O SDK valida os argumentos contra `inputSchema` **antes** do handler rodar;
  argumento inválido vira resultado `{ isError: true }` e o handler **não** roda.
- O handler recebe um **segundo argumento** `ctx: ServerContext` (SDK v2). Ele
  expõe `ctx.mcpReq.notify(notification)` para mandar uma notificação pelo mesmo
  canal da requisição — é o mecanismo do streaming do agente
  (`notifications/agent/stream`). O core adapta isso num `ToolContext.notify`
  dependency-light (`common/mcp/types.ts`); handlers nunca importam o tipo do SDK
  diretamente. Notificação é **best-effort**: um erro ao enviar nunca deve falhar
  o turno que a originou.
- **`stdout` é o canal JSON-RPC.** Nunca `console.log` no core — use `console.error`.
- Com TypeScript ≥ 6, `@types/*` não é mais incluído automaticamente: mantenha
  `"types": ["node"]` no `tsconfig.json`.

## Invariantes arquiteturais

- `common/` é headless: **sem DOM, sem React, sem `window`/`document`** (alvo WASM).
- `variants/desktop` importa do core **apenas tipos** (`import type`), nunca valores —
  o core depende de `node:*`, que não existe no browser.
- Imports relativos usam extensão explícita `.ts`/`.tsx`; mantenha
  `allowImportingTsExtensions: true` + `noEmit: true`.
- `module: "ESNext"` + `moduleResolution: "bundler"`; valores de `paths` com `./`.
- `@core/*` → `./common/*`.
- Registro de tools é type-erased (`AnyToolHandler`); as APIs públicas continuam
  genéricas para os handlers inferirem argumentos de `inputSchema`.
- `common/agent/` fala com modelos via `fetch` injetável (`LlmFetcher` para
  resposta única, `LlmStreamFetcher` para streaming). `runAgentTurn` aceita um
  `onProgress` opcional para emitir `answer_delta`/`tool_call`; sem ele nada
  streama. O `answer_delta.text` é o **preview completo** extraído do JSON ainda
  incompleto (`answerPreview`), e o valor final vem do parse completo.
- `variants/desktop/src/lib/shell.ts` é o **único** lugar que sabe como a webview
  alcança o shell (comandos Tauri + eventos). `lib/coreClient.ts` desembrulha o
  envelope das tools. Nenhum outro componente importa `window.__TAURI__`
  diretamente.
- `common/lsp/` é a ponte LSP: protocolo **agnóstico de transporte** (`LspClient`
  recebe um `LspTransport`), com `stdioTransport` para o processo filho e
  `languageService` traduzindo `publishDiagnostics` em `InlineHint`; o
  `LanguageServerManager` orquestra os servidores (início lazy, `refresh` com
  espera, tools MCP). O framing (`Content-Length` em **bytes**) é a única parte que
  pode corromper silenciosamente tudo o que vem depois — mantenha os testes de
  chunk dividido verdes.
- **A surface de tools MCP é asserida em três lugares.** Ao adicionar, remover ou
  renomear uma tool, atualize os três ou o CI fica vermelho: `common/core.test.ts`
  (lista ordenada), `scripts/smoke-mcp.ts` (`EXPECTED_TOOLS`, conta exata) e
  `src-tauri/src/mcp.rs` (teste e2e `handshakes_with_the_real_core`). A surface
  atual são **11 tools**.
- **No shell (`src-tauri`), comando síncrono roda na main thread.** Qualquer comando
  que bloqueie — chamada ao core (`call_core_tool`), handshake, probe, shutdown de
  sessão — tem de ser `async fn` e rodar o trabalho bloqueante com
  `tauri::async_runtime::spawn_blocking`. Um comando síncrono bloqueando por
  segundos congela o WebKitGTK e o app aparece como "não está respondendo" (foi o
  bug da §5 item 16). Use `tauri::State` só em comandos instantâneos; para os
  bloqueantes, receba `tauri::AppHandle` e chame `app.state::<T>()` **dentro** do
  closure `move` do `spawn_blocking` (o `State` pega emprestado do `AppHandle`).
- **O sandbox tem um contrato de argv, e ele é `argv[0]` = binário.** `DockerSandbox`
  monta o argv **completo** (`['docker', 'run', …]`) porque o executor spawna
  `argv[0]` direto — `LocalRunner` passa `['sh', '-lc', …]` pelo mesmo caminho. Um
  argv começando em `run` vira `spawn('run')` → `ENOENT` → `exitCode: 127` em
  **toda** chamada, e como os testes usavam executor falso, ninguém via (foi o bug
  da §3 item 25). Duas regras saem disso: (a) mudança de argv precisa de um teste
  que **rode um processo de verdade**; (b) novidade testada só com dublê está
  testada pela metade.
- **No sandbox, não rode como root.** `--cap-drop ALL` + root remove o
  `CAP_DAC_OVERRIDE`, então o container **não consegue escrever** numa pasta do
  usuário (`Permission denied`) e, onde consegue, deixa arquivos com dono `root` no
  projeto. O run usa `--user <uid>:<gid>` do usuário atual e `HOME=/tmp` (§3 item
  26). No Windows a flag é omitida: não há uid e o Docker Desktop trata permissões.
- **A sessão do core é única e serializada.** `ShellState::with_core` segura um
  `Mutex` por toda a chamada, então **duas chamadas de tool nunca rodam juntas**, e
  `ask_agent` segura esse mutex por todo o tempo do modelo (minutos num modelo
  local). Consequência para quem escreve UI: **nunca dispare uma chamada de core por
  evento** (cada tecla, cada pixel de scroll) — as requisições ficam *enfileiradas no
  mutex* e a espera se acumula. Debounce e **no máximo uma em voo** (veja
  `flushEditorContext` em `App.tsx`). A solução de fundo é a fila no sidecar (§5
  item 6-a do `PROJECT_STATE.md`).
- **O orçamento do agente tem quatro números espelhados entre camadas.** O padrão e o
  teto do tempo (600 s, 24 h) vivem em `src-tauri/src/mcp.rs` (`tool_timeout`) e o
  mínimo/máximo de passos em `common/agent/agentLoop.ts` (`DEFAULT_MAX_STEPS` /
  `MAX_MAX_STEPS`); a UI **não pode importar valores** do core nem ler o Rust, então
  `App.tsx` repete os quatro com comentário apontando a origem. Mudar um lado sem o
  outro deixa o campo mostrando um número que a outra camada vai silenciosamente
  trocar. **`0` é o único valor especial:** no tempo significa "sem prazo" (a espera
  usa `recv()` sem deadline, não um número gigante — `Instant + Duration::MAX` entra
  em pânico), e no tempo um valor positivo abaixo de 10 s sobe para 10 s.
- **Testes são cross-platform (o CI roda em Ubuntu/Windows/macOS).** Nunca fixe
  strings que dependem de plataforma: use `pathToFileURL`/`fileURLToPath`,
  `isAbsolute`/`join` (`node:path`) e compare contra o mesmo helper em vez de um
  literal. Um `file:///ws` fixo vira `file:///D:/ws` no Windows e derruba o job —
  já aconteceu (ver o commit `ed83db3`). O mesmo vale para separador `/` hardcoded.
  Localmente (Linux) esses erros passam; **só o CI os pega**, então não confie num
  verde local para concluir que está portável.

## Duas máquinas — descubra em qual você está antes de afirmar qualquer coisa

Este projeto é trabalhado de **duas máquinas** com capacidades muito diferentes.
Perfil completo e regra de delegação: **`docs/MACHINES.md`**.

**Rode isto primeiro, toda sessão:**

```sh
sh scripts/env-probe.sh            # relatório completo
sh scripts/env-probe.sh --brief    # identidade + o essencial
```

- **Máquina A** — a máquina de build. *Ainda não perfilada* (`VERIFICATION
  REQUIRED`): rode o probe lá e preencha `docs/MACHINES.md`.
- **Máquina B** — `juju-hppaviliong4notebookpc`, `machine-id` `3e798a6d`.
  **Não compila** (sem `node`/`npm`/`cargo`) e **não roda o sandbox Docker**
  (usuário fora do grupo `docker`). **Consegue** rodar o app empacotado
  (WebKitGTK presente) e **exercitar o agente** (`ollama` rodando).

**A regra: quem consegue executar uma verificação é quem a relata.** Na máquina B,
`lint`/`typecheck`/`test`/`build` e o Docker são delegados ao CI — leia o run,
cite a anotação e diga que rodou no GitHub. Nunca relate uma verificação que você
não obteve, e nunca deduza a máquina: o probe responde.

## Como verificar o seu trabalho

⚠️ **Verificado em 2026-10-07 na máquina B: ela NÃO tem `node`/`npm`, NÃO tem
`cargo`/`rustc`, e o `docker` está instalado mas sem permissão** (socket
`root:docker`, usuário fora do grupo). `npm install`/`lint`/`typecheck`/`test`/
`build` **não** rodam lá, e o sandbox Docker **não** pode ser exercitado lá.
**O GitHub Actions é o único compilador.** Se você não conseguiu executar uma
verificação, diga isso — não a declare. (Nesta máquina de build, sim, tudo roda:
confirme com `sh scripts/env-probe.sh`.)

O que existe na máquina B para validar: **Python 3.13 + PyYAML** (parse de YAML e
`bash -n` nos workflows, truque que já pegou bug real) e **`ollama`**, que permite
exercitar o loop do agente contra um modelo real (`deepseek-r1:1.5b` local).

Quando o Node existir, a verificação é:

```bash
npm install
npm run lint && npm run typecheck && npm run test && npm run build
npm run smoke            # sobe dist/core.mjs e o dirige com um cliente MCP real
npm run build:desktop    # empacota a UI (Vite + Tailwind v4 + alias @core)
```

O `cargo check` **completo** do `src-tauri/src/main.rs` nunca roda localmente: ele
exige as libs de sistema do Tauri (GTK/WebKitGTK) e `sudo` sem senha não existe
aqui. Deixe o workflow `tauri` validar o `main.rs` no CI.

O GitHub Actions é a fonte de verdade: o workflow `build` roda
`lint → typecheck → test → build → smoke` na matriz 3 SOs × 2 Node, e o workflow
`tauri` roda `cargo check` + `cargo test --include-ignored` quando
`src-tauri/**`, `variants/desktop/**` ou `common/**` mudam.

**Não declare uma tarefa concluída** se `lint`/`typecheck`/`test`/`build` não
passaram. Se não puder executá-los, diga isso explicitamente.

## Convenções de mudança

- Commits em [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.
- Mudança pública no core exige teste em `common/**/*.test.ts` (Vitest).
- Não comite `node_modules/`, `dist/`, `*.log` (ver `.gitignore`).
- `layout/` está fora de lint e build: é **referência de design**, não código de produção.
- Ao terminar, atualize `docs/PROJECT_STATE.md` (§2 status, §5 próximos passos,
  commit de referência) — é o que mantém a continuidade.
