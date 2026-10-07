# PROJECT STATE — NexusAgent Studio

> **Arquivo de rastro (handoff).** Existe para que a ideia, as decisões e o ponto
> de parada sobrevivam ao fim de uma janela de contexto. Se você é uma IA ou um
> humano retomando este repositório, **leia este arquivo primeiro**.
>
> **Última atualização:** 2026-10-07 · **Commit atual:** confira com
> `git log -1 --oneline`
>
> **Como ler isto rápido:** §2 diz o que está pronto, §3 lista o que está bloqueado
> (e como destravar), §5 item 17 é onde a fatia atual parou.

> **⚠️ ANTES DE AFIRMAR QUALQUER COISA — rode o probe.** Este projeto é trabalhado
> de **duas máquinas** com capacidades muito diferentes, e assumir a errada é como
> uma sessão acaba declarando um `npm test` que nunca rodou. O perfil canônico está
> em **`docs/MACHINES.md`**; a verdade é o comando:
>
> ```sh
> sh scripts/env-probe.sh
> ```
>
> **Máquina A** (build, ainda não perfilada) · **Máquina B**
> (`juju-hppaviliong4notebookpc`, `machine-id` `3e798a6d`): **não compila** e **não
> roda Docker**; consegue rodar o app empacotado e exercitar o agente.
> **Quem pode executar uma verificação é quem a relata.**

---

## 1. O que é o projeto

Um editor de código multiplataforma de alta performance com:

- **núcleo headless** (`common/`) sem DOM/React — MCP server interno, logger
  event-sourced, sandbox Docker, sistema de plugins, temas reativos;
- **variante desktop** (`variants/desktop/`) em React 19 + Tailwind v4, cuja
  identidade visual vem da pasta `layout/` (os HTMLs de referência que o dono do
  projeto aprovou);
- **plugins** (`plugins/`) que injetam tools MCP dinamicamente.

Fluxo: UI → `InternalMCPServer` → (tools de arquivo / `run_terminal_command`) →
sandbox Docker → parser de erros → `ExecutionLogger` + inline hints → UI.

## 2. Status por fase

| Fase | Escopo | Código | Verificado em runtime |
| --- | --- | --- | --- |
| 1 | Infra, CI/CD, governança | ✅ completo | ✅ o CI executa `npm ci → lint → typecheck → test → build → smoke` |
| 2 | Core TypeScript (`common/`) | ✅ completo | 🟡 parcial: o servidor MCP é exercitado ponta a ponta; temas e plugins só em teste unitário |
| 3 | Sandbox + shell | ✅ completo | ✅ `cargo check`/`cargo test` verdes; sem Docker no CI, mas há `LocalRunner` opt-in (`NEXUS_UNSANDBOXED=1`) |
| 4 | Arquitetura de plugins | ✅ completo | 🟡 parcial: registro/unload cobertos por teste, mas nenhum plugin real foi carregado |
| 5 | Configuração e build | ✅ completo | ✅ `build:desktop` roda no CI e o bundle portátil se verifica por handshake dentro de si |
| 6 | UI desktop ligada ao core | ✅ completo | ✅ explorador, editor, terminal, configurações e agente falam com o core; janela só abre na máquina do dono (WebKitGTK) |
| 7 | Agente + aprovação passo a passo | ✅ completo | ✅ loop exercitado contra **modelos reais** (Ollama local, §5 item 19) — foi assim que apareceram os defeitos de relato e de repetição; a UI que consome o resultado segue verificada no browser |

**Resumo: o pipeline está VERDE — 8 jobs** (6 de `build` × SO/Node, `cargo check`
e o bundle `desktop-binary`). Nada mais é simulado: a UI, o agente e a aprovação
passo a passo falam com o core de verdade.

> ⚠️ **AMBIENTE — re-verificado em 2026-10-07.** A nota anterior aqui afirmava que
> "a máquina agora tem `node` 22 + `npm` 9, Rust via `rustup` e `docker`
> funcionando". **Uma das três era falsa na época e as outras duas mudaram depois:**
> `node`/`npm` continuam **ausentes** (nenhum nvm/volta/fnm/snap; o candidato do apt
> é Node 20, abaixo do piso `>=22`), então **`npm install`/`lint`/`typecheck`/`test`/
> `build` não rodam aqui e o CI continua sendo o único compilador de TypeScript**.
> **O `docker` mudou de fato:** usuário adicionado ao grupo `docker`, daemon
> responde e o sandbox passou a ser verificável aqui (§3 item 30). **E o `cargo`
> também:** instalado em **user-space** via `rustup` (§3 item 31), o que deu aos
> módulos Rust Tauri-free um ciclo de teste local que eles nunca tiveram. O que
> **falta** segue igual: `sudo` sem senha, então compilar `src-tauri/src/main.rs`
> (que exige `pkg-config` + libs GTK/WebKitGTK de sistema) depende do CI
> (`tauri.yml`).
>
> **Isto agora é máquina, não acidente.** O perfil completo das **duas** máquinas
> está em **`docs/MACHINES.md`**, e `scripts/env-probe.sh` responde em um comando
> qual delas está em uso e o que ela consegue fazer. **O probe também verifica se
> esta máquina já está perfilada** e, se não estiver, termina dizendo isso —
> perfilar vem antes de qualquer outro trabalho. Rode antes de afirmar. O modelo local é `deepseek-r1:1.5b` via
Ollama (lento, sem GPU), mas agora **livremente selecionável na UI** (ver §5).

No run **37404728248** (commit `ab839aa`) os 6 jobs originais passaram com todos os
passos verdes:

- ✅ `npm ci` — instala exatamente o que o lockfile fixa.
- ✅ `npm run lint` — passa.
- ✅ `npm run typecheck` — passa (depois de corrigir os 6 erros do run 37402173198; §3, linhas 7–8).
- ✅ `npm run test` — passa (Vitest, 8 arquivos).
- ✅ `npm run build` — passa; gera `dist/core.mjs`.
- ✅ `npm run smoke` — passa nos 3 SOs, inclusive **Windows**.

**O que o smoke test realmente prova** (não é só "passou"): ele sobe o
`dist/core.mjs` de produção e o dirige com um cliente MCP real via stdio. O handshake
completa; `tools/list` devolve **exatamente** as 7 tools esperadas — o que só é
possível se o SDK converter cada schema Zod em JSON Schema **em runtime**, coisa que o
typecheck não prova; `read_file` lê o `package.json`; uma chamada **sem o argumento
obrigatório** é rejeitada com `isError: true` **antes** do handler rodar; um caminho
com `../` é recusado; e o servidor continua respondendo depois dos dois erros.

## 3. Bloqueio atual e como resolvê-lo

| # | Bloqueio | Estado / resolução |
| --- | --- | --- |
| 1 | Sem Node/npm na máquina local | 🟡 **PARCIALMENTE RESOLVIDO em 2026-10-07.** `node`/`npm` e `cargo`/`rustc` continuam **ausentes** (o candidato do apt é Node 20, abaixo do piso `>=22`), então **`lint`/`typecheck`/`test`/`build` não rodam aqui e o CI é o único compilador**. O que mudou: **`docker` passou a funcionar** (usuário no grupo `docker`), então o **sandbox é verificável nesta máquina** — feito, §3 item 30. `ollama` também está disponível para exercitar o agente. Perfil das duas máquinas em `docs/MACHINES.md`; o detector é `sh scripts/env-probe.sh`. |
| 2 | `package-lock.json` ausente → `npm ci` e `cache: npm` falhariam no CI | ✅ **RESOLVIDO.** O lockfile foi gerado pelo workflow `bootstrap-lockfile`, **validado contra o `package.json`** e commitado na raiz. O `build.yml` voltou para `npm ci` + `cache: npm`. O arquivo tem 239 entradas, `lockfileVersion: 3`, e `dependencies`/`devDependencies` batem **exatamente** com o manifesto. `typescript` resolveu em **6.0.3** — dentro da faixa `~6.0.2` e do peer `>=4.8.4 <6.1.0` do `typescript-eslint@8.71.1`. |
| 3 | `git push` requer credenciais | ✅ **RESOLVIDO.** HTTPS não tinha credencial, mas a chave `~/.ssh/id_ed25519` já está autorizada na conta. O remote `origin` foi apontado para SSH: `git@github.com:xtrempkch-droid/nexus-agent-studio.git`. |
| 4 | A UI desktop é uma **simulação** no browser | Falta a ponte IPC (Electron/Tauri) entre `variants/desktop` e `common/`. Ver §5. |
| 5 | `npm install` falhava no CI (run #34, os 6 jobs) | ✅ **RESOLVIDO e confirmado.** Causa: `typescript-eslint@8.71.1` declara `peerDependencies.typescript: ">=4.8.4 <6.1.0"` e eu havia declarado `typescript ^7.0.2` → `ERESOLVE`, exit 1 no passo de install, com `lint`/`typecheck`/`test`/`build` **skipped**. Agora `typescript: "~6.0.2"` e o install passa. |
| 6 | `npm run lint` acusou 1 erro (run 37401758113) | ✅ **CORRIGIDO.** `defaultImage` era declarado mas ignorado em `createTerminalTools` — o schema fixava `DEFAULT_SANDBOX_IMAGE`, então `CoreOptions.sandboxImage` só afetava o `TerminalRunner` e **não** a tool `run_terminal_command`. Agora o schema usa `defaultImage`. Era bug real, não só ruído de lint. |
| 7 | `npm run typecheck`: falta de declaração de módulo (run 37402173198) | ✅ **CORRIGIDO.** `variants/desktop/src/main.tsx:10` → `Cannot find module or type declarations for side-effect import of './styles/theme.css'`. Causa: **não existia nenhum `.d.ts` no projeto**, então o import de CSS não resolvia. Criado `variants/desktop/src/vite-env.d.ts` com `/// <reference types="vite/client" />` — o `client.d.ts` do Vite declara `declare module '*.css' {}` (verificado em `vite@8.3.2`, cujo `package.json` expõe `exports["./client"] = { types: "./client.d.ts" }`). `.d.ts` é ignorado pelo ESLint, então a triple-slash reference não viola nenhuma regra. |
| 8 | `npm run typecheck`: 5 erros em `common/mcp/server.test.ts` | ✅ **CORRIGIDO.** Linhas 87/92/96/111/116, todos a mesma causa: os dois `const handler` extraídos perdiam a **tipagem contextual**, então `type: 'text'` **alargava para `string`** e o retorno deixava de ser atribuível a `TextContentBlock`. Os arrows inline (linhas 25/63/75) **não** erravam — prova de que a causa era o literal solto, não a API. Corrigido usando o helper `textResult` que já era exportado. **Os tipos da lib estavam corretos; o teste é que estava.** |
| 9 | `build()` e `serveStdio()` sem cobertura de runtime | ✅ **RESOLVIDO.** Nenhum dos 8 arquivos de teste chamava `build()` nem `serveStdio()` — as duas apareciam apenas no bootstrap (`common/index.ts`) e em comentários. Ou seja, a fronteira com o SDK v2, a parte mais arriscada do projeto, **nunca havia executado**: o typecheck provava só que os tipos encaixam, não que o SDK converte os schemas Zod em runtime. Criado `scripts/smoke-mcp.ts` + o passo `Smoke test (MCP over stdio)` no CI (depois do build, pois sobe `dist/core.mjs`). Run 37404728248: verde nos 6 jobs, inclusive Windows. |
| 10 | A UI nunca era empacotada pelo Vite | ✅ **CORRIGIDO no código.** `npm run build:desktop` não rodava em lugar nenhum: o `tsc` aprovava a UI, mas aprovar tipos não diz nada sobre o Vite resolver `@tailwindcss/vite`, `@vitejs/plugin-react`, o `@theme` do Tailwind v4 e o alias `@core`. Adicionado o passo `Build (desktop)` (commit `29b9e0a`). **Confirmado verde** no run do commit `641fa13`: o Vite resolve os plugins, o `@theme` do Tailwind v4 e o alias `@core`. |
| 11 | O host desktop não existia (ponte IPC sem lugar para viver) | ✅ **RESOLVIDO.** Criado `src-tauri/` (`Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, ícone, um único comando `shell_info`) sob um workflow `tauri` **separado**, que roda `cargo check` só quando `src-tauri/**` ou `variants/desktop/**` mudam — compilar Tauri leva minutos e não deve travar o loop rápido do TypeScript. O passo captura a saída do cargo e a reemite como `::error::`, porque log bruto do Actions exige autenticação e anotação não: sem isso, uma falha do Rust seria só um X vermelho. Run do commit `641fa13`: **`cargo check` verde**. Run de `fb2cff6`: **`cargo check` e `cargo test` verdes**. |
| 12 | **Eu inventei três métodos de API do Rust** | ✅ **CORRIGIDO e confirmado verde — leia isto antes de escrever Rust aqui.** Usei `command.get_stdin()`, `get_stdout()` e `get_stderr()` afirmando que existiam desde o Rust 1.57. Existem `get_program`, `get_args` e `get_current_dir` — mas **os três getters de stream não existem**. O CI apontou `error[E0599]` nas três linhas. É exatamente o erro que a regra nº 1 do `AGENTS.md` existe para pegar, e eu caí nele por confiar na memória em vez de conferir. Substituído por testes **comportamentais** (sobem `printf`/`sh` de verdade e leem stdout/stdin/stderr), que provam **mais** do que introspecção provaria. O canal de `::error::` no workflow `tauri` foi o que tornou isso diagnosticável sem acesso ao log bruto. |
| 13 | O Rust não falava MCP | ✅ **RESOLVIDO e confirmado.** `src-tauri/src/mcp.rs` implementa `initialize` + `notifications/initialized` + `tools/list` sobre JSON-RPC delimitado por linha, com loop de leitura por `id` (pulando notificações no canal compartilhado), timeout por passo e shutdown fechando o `stdin` primeiro (o sinal gracioso portável da spec). O teste end-to-end sobe o core **real** e afirma as 5 tools; CI verde. **Fato medido, não suposto:** a anotação `::notice::` reportou `negotiated protocol 2025-11-25, 5 tools`. O core **não aceita** `2026-07-28` no handshake legado — ele negocia para **2025-11-25**. Se eu tivesse *afirmado* a versão em vez de *pedi-la*, o teste teria falhado **com o handshake funcionando**. Corolário: para usar recursos da era 2026-07-28 é preciso o fluxo moderno (`server/discover` + metadados em `_meta`), porque a era moderna **não tem** handshake `initialize` para negociar. |
| 14 | Cada comando abria e matava um core | ✅ **RESOLVIDO e confirmado.** `ShellState` guarda `Mutex<Option<CoreSession>>`: sobe no primeiro uso, reutiliza, e **substitui se o processo morreu** — a spec diz que o cliente *deveria* reiniciar um servidor que saiu inesperadamente, e o protocolo é stateless. Adicionado `tools/call` e o comando `call_core_tool`. A anotação `::notice::` do run confirmou o caminho completo: `2025-11-25, 5 tools, tools/call ok`. **Limitação conhecida e documentada:** o mutex serializa as chamadas (obrigatório, porque stdio é um canal único), então uma tool lenta bloqueia as outras — uma fila de requisições está na §5. |
| 15 | A UI nunca falou com o core | 🟡 **METADE RESOLVIDA: o sistema de arquivos é real, o agente não.** `lib/shell.ts` é a ponte tipada — o **único** lugar que sabe como a webview alcança o shell — e `lib/coreClient.ts` desembrulha o envelope das tools. Ligados ao core: explorador (`list_directory`), editor (`read_file`; gravação com **Ctrl+S** via `write_file`), shell interativo e execução de testes (`run_terminal_command`). O crachá e o rótulo da raiz do explorador reportam o workspace **real**; no browser nada foi injetado, então aparecem os arquivos de pré-visualização. `app.withGlobalTauri: true` evita dependência nova e **não invalida o lockfile**. **A metade do agente continua simulada** e agora a primeira mensagem diz isso: não há modelo conectado, então o chat é roteiro fixo. **Removida a mentira mais convincente do app:** o botão de testes imprimia `✓ 1 passed in 0.08s` incondicionalmente — parecia evidência e era uma constante. Hoje mostra o que o sandbox devolveu, inclusive a recusa. Tornar o chat real exige um LLM de verdade. |
| 16 | Ninguém nunca abriu o app | 🟡 **BUNDLE PRODUZIDO E VERIFICADO; a janela ainda não foi aberta.** `.github/workflows/desktop-binary.yml` monta um bundle portátil: `npx --yes @tauri-apps/cli@2.12.1 build --no-bundle --ci` (sem instalador e sem exigir `.ico`/`.icns`), mais `dist/core.mjs`, `node_modules` de produção e um runtime Node em `runtime/node`. **Dois defeitos reais na 1ª versão, ambos corrigidos:** (a) `dist/core.mjs` é construído com `--packages=external`, então importa o SDK e o zod **em tempo de execução** — sem `node_modules` o core morre com `ERR_MODULE_NOT_FOUND`, e o smoke test **não pega isso** porque ali `node_modules` já existe; (b) passar dois arquivos separados ao `upload-artifact` usa o **ancestral comum** deles como raiz — a raiz do repositório — enterrando o executável em `src-tauri/`. Agora o passo monta um diretório único e envia só ele. A etapa `Verify the bundle handshakes on its own` roda o core com o runtime empacotado **de dentro do bundle** — é o teste que teria pego (a). **ubuntu-22.04 de propósito:** o binário liga contra o glibc do build, e 2.35 roda também no 24.04, mas o inverso não roda. **`npx` em vez de dependência:** declarar `@tauri-apps/cli` invalidaria o `package-lock.json` e quebraria o `npm ci`. **Pré-requisito que sobra:** WebKitGTK em runtime — nenhum empacotamento substitui isso. |
| 17 | O app não tinha **projeto nenhum** para abrir | ✅ **CORRIGIDO — e era a causa de "as funções não funcionam".** `ShellState` usava **um** diretório para duas coisas incompatíveis: onde o bundle está (para achar `dist/core.mjs` e `runtime/node`) e qual projeto editar. Como o core deriva o workspace do **próprio diretório de trabalho** (`startStdioServer(workspaceRoot = process.cwd())`), o resultado era o editor apontado para a pasta do bundle — sem código — e nenhuma forma de abrir um projeto. Agora `app_root` e `workspace_root` são campos separados: o binário vem de um, o `current_dir` do processo filho é o outro. `RUN.sh` recebe o diretório (`bash RUN.sh ~/meu-projeto`) e o repassa em `NEXUS_WORKSPACE`; sem argumento o core cairia na pasta do bundle, então o script valida e falha cedo em vez de abrir vazio. `CoreConfig::for_workspace` virou `for_app_root` — o nome antigo foi o que me fez confundir as duas grandezas. O rótulo `workspace / my-python-project` saiu do cabeçalho: era literal enquanto o editor olhava para outro lugar, o que torna workspace errado indistinguível de workspace vazio. Teste de regressão: `core_command_takes_the_core_from_the_app_root_but_runs_in_the_workspace`. |
| 18 | O explorador percorria `.git` | ✅ **CORRIGIDO.** `list_directory` não tinha noção de ruído: `.git/objects` guarda mais arquivos que o código-fonte, então a caminhada gastava o orçamento de **2000 entradas** em hashes de objeto e a árvore que o usuário via era quase toda lixo. Adicionada `DEFAULT_EXCLUDED_DIRECTORIES` — controle de versão e árvores de dependência, a mesma escolha que os editores fazem por padrão — e a opção `excludedDirectories` para sobrescrever. **É um padrão, não uma proibição:** o filtro age nas *entradas* de uma caminhada, não no ponto de partida, então `list_directory` sobre `node_modules` explícito continua funcionando. **A resposta de verdade é respeitar `.gitignore`**, porque lista fixa não sabe que um projeto guarda código em `target/` — fica para depois. O módulo também **não tinha nenhum teste**: criado `common/mcp/tools/fileTools.test.ts` com 9 casos sobre diretório temporário real, cobrindo a exclusão, o caso explícito, o override, o round-trip de `write_file`/`read_file` e as duas recusas de path traversal. |
| 23 | Assistido/Autônomo era decorativo | ✅ **RESOLVIDO.** O toggle não fazia diferença: os dois modos executavam a tarefa inteira. Agora o **Assistido pausa** o loop antes de `write_file` e `run_terminal_command` (só mutação; leitura nunca pausa), devolve a tool + argumentos à UI, e retoma **a mesma conversa** quando o usuário aprova ou rejeita. O core continua **sem estado**: o turno pausado devolve `history` + `assistantJson` + a tool pendente, e a próxima chamada `ask_agent` os devolve com `decision`. Aprovar executa; rejeitar alimenta o modelo com a recusa e deixa ele continuar. `approveAll` vira autônomo de fato (`assisted` + `approveAll` → `autonomous`). 6 testes novos no loop. |
| 22 | O chat era roteiro fixo | ✅ **RESOLVIDO — a última simulação saiu.** O chat agora roda um turno de agente real contra o provedor e modelo escolhidos nas configurações: o prompt vai ao modelo, o modelo pode chamar as tools do workspace pelo core, e a resposta é o que o usuário vê. **Tool calling por prompt** com `format: "json"`, não o `tools` nativo — o nativo exige JSON Schema por tool e um template de tool calling, e o `deepseek-r1:1.5b` (distill de raciocínio) não tem. Endpoints verificados contra o servidor vivo antes de escrever código: `/api/chat` → `message.content`; `/v1/chat/completions` → `choices[0].message.content`. O agente vive no core (`common/agent/`), registrado por último e **nunca oferecido a si mesmo**. Loop limitado a 6 passos com saídas explícitas: chamada, resposta, saída não-JSON tratada como resposta, ou estouro do teto. `fetch` injetável; 11 testes novos. **Ficou de fora, e está registrado:** aprovação passo a passo (o modo Assistido executa a tarefa inteira) — é a próxima fatia. |
| 19 | O terminal não executava nada | ✅ **RESOLVIDO — e o motivo era outro.** Este item atribuía o "não executa" só à ausência de Docker; medindo em runtime (§3 itens 25–26), o sandbox **nunca executou nada em máquina nenhuma**: faltava o binário `docker` no argv e, corrigido isso, o container não conseguia escrever no projeto. O `LocalRunner` continua existindo como alternativa **opt-in** (`NEXUS_UNSANDBOXED=1`), mas deixou de ser a única forma de o terminal funcionar. Histórico: implementa o **mesmo contrato** `run()` do `DockerSandbox`; o tipo `Sandbox` virou `Pick<DockerSandbox, 'run'>`, então os tools não sabem qual receberam. Ligado apenas por `NEXUS_UNSANDBOXED=1`, lido em `common/index.ts` — **nunca do webview**, que não pode desligar isolamento. **O rótulo é a história de segurança:** todo resultado reporta `image: 'local (sem isolamento)'` e **nunca** a imagem pedida, porque nada rodou nela; um log que não distingue contêiner de host é pior que log nenhum. `shellArgv` é parametrizado por plataforma para o ramo Windows ser testável a partir do Linux. Testes: `localRunner.test.ts` (9 casos, executor injetado + **1 caso que roda `sh -lc` de verdade**, para travar o contrato do executor) e `core.test.ts` (4 casos, incluindo "sandbox por padrão" e "injeção vence a flag"). |
| 20 | Não dava para abrir pastas | ✅ **CORRIGIDO.** O explorador era uma lista plana **só de arquivos**: `list_directory` devolvia pastas e arquivos, mas a UI descartava os diretórios — abrir uma pasta era impossível, e não havia ação de "abrir arquivo". Agora o explorador lista arquivos **e** subdiretórios da pasta atual, clicar numa pasta entra nela, e há breadcrumb + `..` para subir, com a raiz sempre acessível. Abrir um arquivo insere o registro na lista de abertos **antes** de lê-lo — o explorador lista uma pasta por vez, então o editor não tinha onde pôr conteúdo que ainda não tinha visto. `FileExplorer` trocou o modelo de `files` por `entries` + `statuses` + `currentDir`. |
| 21 | Configurações duras no Ollama | ✅ **CORRIGIDO.** O modal tinha um único campo de URL do Ollama e o seletor de modelo era uma lista **falsa** de nomes fixos. Agora: **lista de provedores** (nome, tipo `ollama`/`openai` e URL), botão **Sincronizar modelos** que pergunta ao provedor ativo via a nova tool `list_models` e lista os nomes para o usuário escolher o ativo; o seletor do cabeçalho é construído dos modelos sincronizados. **Formato verificado contra o servidor vivo** (`/api/tags` → `{models:[{name}]}`; `/v1/models` → `{object:list,data:[{id}]}`), não assumido; a tool nasceu com `fetch` injetável e testes. **Consequência que quebrou o CI:** a superfície subiu de 5 para 6 tools, e a lista é afirmada em **três lugares** — smoke test TS, composição do core e teste e2e do Rust; atualizei dois e esqueci o terceiro. Lição: antes de adicionar tool, `grep` por todas as listas exatas. |
| 24 | O PR #7 foi mergeado **sem os dois últimos commits** (correção do travamento e botão Salvar) | ✅ **RESOLVIDO no PR #8** (`091c0dd`). `7d5f2f6` (merge do #7) trouxe só `651de18` + `dc6253d`; `471b1fc` (`async` + `spawn_blocking`, botão Salvar) e `b98ea32` (docs) ficaram para trás, e **depois do merge nenhum workflow rodava naquele branch** (`build.yml` dispara em `push` para `main` ou `pull_request`; sem PR aberto não há evento — foi por isso que o CI pareceu parar). Os dois commits foram levados para o `feat/editor-context`, e o PR **#8** deu **7/7 checks verdes** — incluindo o `cargo check` + `cargo test` que o Rust precisa (ele **não compila na máquina do dono**: falta `libdbus-1-dev`/GTK de sistema e `sudo` pede senha). O log do job é a prova de runtime: `mcp handshake ok: negotiated protocol 2025-11-25, 11 tools, tools/call ok` e `17 passed; 0 failed`. **O `.exe` existente ainda é anterior a isso** — precisa ser reconstruído para o travamento ir embora. |

| 25 | **O sandbox Docker nunca executou nada** — o argv não tinha o binário | ✅ **CORRIGIDO e verificado em runtime** (a máquina agora tem Docker: *socket `root:docker`, usuário no grupo*). `DockerSandbox.buildArgv` devolvia `['run', '--rm', …]`, sem o `docker`, e `run()` entregava esse array ao executor, cujo contrato é `argv[0]` = **binário** (`LocalRunner` passa `['sh','-lc',…]`). Resultado: `spawn('run')` → `ENOENT` → **todo** `run_terminal_command` devolvia `exitCode: 127` e stdout vazio. Os testes não pegavam porque **todos** usavam executor falso e `expect(argv.slice(0, 2)).toEqual(['run', '--rm'])` **codificava o bug**. Agora `argv[0]` é `docker` e há um teste que roda um `sh -lc` **real** para travar o contrato do executor. |
| 26 | **O container não conseguia escrever no projeto** (e sujava a pasta com arquivos do `root`) | ✅ **CORRIGIDO e verificado.** `--cap-drop ALL` + root **remove o `CAP_DAC_OVERRIDE`**: o uid 0 do container deixa de ser capaz de escrever num diretório do usuário do desktop → `gcc -o app main.c` falhava com `Permission denied`. Pior: onde ele *podia* escrever (diretório world-writable), deixava arquivos com dono `root` no projeto, que o usuário não conseguiria mais editar nem apagar. Agora o container roda como **o próprio usuário** (`--user <uid>:<gid>`, deduzido de `process.getuid()`; no Windows a flag é omitida, porque não há uid e o Docker Desktop trata permissões sozinho) com `HOME=/tmp` (o `/root` da imagem não é gravável pelo usuário mapeado, e `npm`/`pip` quebram sem um HOME gravável; apontar `HOME` para o workspace espalharia caches dentro do projeto — pior). **Prova E2E sobre MCP** (core real, `gcc:latest`): `gcc -o programa main.c && ./programa` → exit 0 e `COMPILOU-E-RODOU`; `CapEff: 0000000000000000`; sem DNS (`--network none`); arquivo quebrado → `exit 1` e **2 hints inline** em `quebrado.c:1` com `source: docker:gcc:latest`; e os arquivos criados no container saem no host como `1000:1000` (do usuário), não `root`. |
| 27 | `--security-opt no-new-privileges` torna o sandbox **inutilizável** naquele kernel | 🟡 **LIMITAÇÃO DE HOST, não universal — e NÃO se reproduz no notebook.** Reproduzido ao vivo **no host X**: com essa flag, **todo** `execve` dentro do container falhava com `EPERM` (`exec /bin/sh: operation not permitted`) — inclusive sozinha, sem `--cap-drop`, sem setuid no binário e com a imagem oficial `busybox` (kernel `7.0.0-38-generic`, Docker 29.8.0 do snap). Não era o nosso argv: era o kernel/runtime. **Medido de novo em 2026-10-07 no notebook** (kernel `6.17.0-41`, Docker nativo 29.7.2): a flag **não** quebra nada — `sh -lc` executa normalmente com e sem ela, então o escape **não é necessário aqui** (§3 item 30). A flag **continua ligada por padrão** (defesa em profundidade contra setuid na imagem) e é desligável **apenas por ambiente**, `NEXUS_SANDBOX_NO_NEW_PRIVILEGES=0`, com marcador na linha de boot (`[no-new-privileges DESLIGADO no sandbox]`) — o webview nunca decide isso. **Lição:** "limitação do kernel" sem dizer *qual* kernel convida a próxima sessão a propagar uma crença falsa. |
| 28 | O Docker do **snap** tem `/tmp` privado → workspace em `/tmp` monta **vazio** | 🟡 **LIMITAÇÃO DE HOST (só o Docker do snap) — NÃO se aplica ao notebook.** No host X o daemon era o snap (`Operating System: Ubuntu Core 24`, `Docker Root Dir: /var/snap/docker/...`): arquivos criados no container num bind de `/tmp` **não apareciam** no host e vice-versa, enquanto `/home` funcionava nos dois sentidos. Consequência lá: um projeto dentro de `/tmp` montava um `/workspace` vazio e o agente compilava contra o nada — falha confusa, não erro. **Medido em 2026-10-07 no notebook:** o daemon é **nativo** (`DockerRootDir=/var/lib/docker`, `Ubuntu 25.10`) e `/tmp` monta **nos dois sentidos** (§3 item 30) — nada a corrigir aqui. Detectar isso continua valendo para quem usar snap (comparar a listagem do host com a do container uma vez por troca de workspace e avisar), mas **não** é um defeito do produto. |
| 29 | **O dono testava um binário de 22 h antes e relatava bugs já corrigidos.** | ⚠️ **ARMADILHA RECORRENTE — leia antes de "consertar" uma queixa.** Em 2026-10-07 o relato era "abre mas não consigo abrir pastas/arquivos, e as configurações de IA estão presas no Ollama" — **tudo isso já estava corrigido em `main`**. O `dist/core.mjs` do bundle baixado (6/out 05:24) expunha **5 tools**; o de `main` expõe **11**. Faltavam justamente `ask_agent` (chat real), `list_models` (sincronizar provedor/modelo), `set_editor_context` e as três de LSP. **Prova direta, não inferência por data:** `grep -c registerTool` no `core.mjs` do bundle, ou procurar os nomes das tools. **Consequência de processo:** o `desktop-binary` só roda em `push`, e **nada avisa o dono que o artefato mudou**. Antes de investigar qualquer queixa de comportamento, **confirme a idade do bundle** (`ls -la ~/Downloads/nexus-agent-studio-linux-x64/dist/core.mjs` e a contagem de tools) — metade das "regressões" some quando o binário é atual. |
| 30 | **O sandbox foi verificado ao vivo nesta máquina — e duas limitações documentadas NÃO se reproduzem aqui** | ✅ **VERIFICADO em 2026-10-07, primeira vez nesta máquina.** Com o usuário no grupo `docker`, o argv **exato** do `buildArgv` foi reproduzido à mão (imagem `alpine`, sem Node — não dá para rodar `npm test`, mas dá para rodar o comando). Resultados: **(a)** o container roda e `--user 1000:1000` funciona — o arquivo criado sai no host como `juju juju`, **editável e apagável** (item 26 confirmado aqui, o problema de dono `root` não ocorre); **(b)** `CapEff: 0000000000000000` — todas as capabilities caem, como projetado; **(c)** `--network none` bloqueia a rede (`bloqueada`); **(d)** `--rm` não deixa container; **(e)** `/tmp` monta normalmente **nos dois sentidos**, `DockerRootDir=/var/lib/docker`. **Duas correções de escopo:** o **item 27 NÃO se reproduz aqui** — `--security-opt no-new-privileges` executa `execve` sem problema neste kernel (`6.17.0-41` + Docker nativo 29.7.2), então a limitação era **daquele host, não universal**, e o escape `NEXUS_SANDBOX_NO_NEW_PRIVILEGES=0` **não é necessário nesta máquina**; e o **item 28 não se aplica** — este daemon é nativo, não o snap, então o `/tmp` privado não existe aqui. **Não feito, e dito para não parecer mais do que é:** o E2E de `gcc:latest` (`gcc -o programa main.c && ./programa`) **não** foi repetido aqui — a imagem tem ~1,2 GB e não foi baixada; o que ficou provado é o mecanismo do sandbox, não o ciclo de compilação. |
| 33 | **O menu do seletor de provedor era branco com texto branco** — ilegível | ✅ **CORRIGIDO** (relatado pelo dono ao usar o app). Causa: **`color-scheme` nunca era declarado**. O `<html>` tinha `class="dark"`, mas isso é uma convenção do **Tailwind** para variantes `dark:` no CSS **nosso** — widget nativo nenhum vê essa classe. Quem decide como o engine desenha controles nativos (o popup do `<select>`, a lista do `<datalist>`, scrollbars, autofill) é a propriedade **`color-scheme`**, e o padrão é claro. Resultado: menu desenhado pela plataforma em branco, texto vindo do `text-slate-200` do `<select>`, ou seja branco sobre branco. Corrigido em `variants/desktop/src/styles/theme.css`: `html { color-scheme: dark }` mais uma regra `option` com as duas cores, porque engines já honraram `color-scheme` para scrollbar e ainda desenharam `<option>` com cores próprias. **Dois mecanismos diferentes, e só um alcança a plataforma** — foi a confusão entre eles que produziu o bug, e é o tipo de coisa que se repete: qualquer widget nativo (checkbox, radio, barra de rolagem, autofill) depende de `color-scheme`, não da classe. **NÃO verificado visualmente:** a correção é de mecanismo, não de pixel — eu não consigo abrir a janela. Se o menu continuar claro, o próximo passo é `appearance: none` nos `<select>` com uma seta própria desenhada. |
| 32 | **A sessão do core era um `Mutex` segurado durante toda a chamada** | ✅ **RESOLVIDO.** `ShellState::with_core` segurava o lock por toda a chamada, então um `ask_agent` de minutos bloqueava **toda** outra tool — e com `timeoutSeconds: 0` a única saída era reiniciar o app. Isso fundia duas coisas que não são a mesma: *o canal é serializado* (inevitável, stdio é um cano só) e *o chamador espera segurando um lock* (evitável). Os dois itens da §5 (a coalescência do editor e o "sem prazo") apenas contornavam o sintoma. Agora `src-tauri/src/worker.rs` tem **uma thread dona da sessão**: nada é segurado durante a chamada, cada pedido espera na própria resposta, e a ordem é **FIFO** (o mutex não tinha ordem nenhuma — quem ganhasse a corrida ia primeiro). **Três decisões que valem registrar:** (1) **o orçamento conta desde a submissão**, porque é isso que "600 s" significa para quem digitou — então um pedido que gastou tudo na fila é recusado **sem ser enviado**, e a mensagem diz qual dos dois casos foi (as correções são diferentes); (2) **1 s de cortesia** (`REPLY_GRACE`) para a resposta específica do worker chegar antes de o chamador desistir do genérico — sem isso os dois disparam no mesmo instante e o chamador, que sabe menos, ganha a corrida; (3) **tempo esgotado não cancela** — o core segue no pedido abandonado e o próximo espera, o que está documentado no módulo em vez de ser descoberto. **Verificado:** 9 testes novos no harness (`26 passed` no total), incluindo ordem, abandono, os dois tipos de expiração e a troca de workspace recusada; **e o harness pagou-se no ato** — apontou três erros de compilação meus (`?` sem `From`, empréstimo mutável em guard de pattern, e uma asserção com caixa errada) antes de qualquer push. **O que não foi verificado:** `main.rs` não compila nesta máquina (sem GTK), então a camada de comandos é verificada só por `rustfmt` (sintaxe) aqui e pelo CI quanto a tipos. |
| 31 | **Os módulos Rust Tauri-free não tinham ciclo de teste local** | ✅ **RESOLVIDO.** `cargo check`/`cargo test` do crate completo exigem `pkg-config` + libs GTK/WebKitGTK de sistema, que esta máquina não tem e cuja instalação pede senha. Então `bridge.rs` e `mcp.rs` — escritos Tauri-free de propósito, exatamente para poderem ser testados sem janela — só eram verificados **depois do push**. Duas partes: **(a)** `rustup` instala inteiro em user-space (`~/.cargo`, `~/.rustup`), sem `sudo` — medido, `cargo 1.99.0`; **atenção ao `PATH`**: a instalação foi `--no-modify-path`, então o probe procura nos **dois** lugares e avisa quando está fora do `PATH`. **(b)** Criado `src-tauri/harness/`, um crate standalone que inclui os dois arquivos **por caminho** (`#[path]`, não cópia — cópia passaria enquanto o arquivo real quebrasse). Resultado: `17 passed` em **0.26 s**, contra ~28 s do crate completo no CI. **A contrapartida, escrita no próprio harness:** um teste aqui só vale para estes dois módulos; exercitar `main.rs` (um comando Tauri) continua sendo CI. `Cargo.lock` commitado para reprodutibilidade, e o `.gitignore` do harness existe porque o `/target/` do `src-tauri/.gitignore` é **ancorado** e não pega o subdiretório — 72 MB apareceriam como untracked. |

## 4. Como verificar (GitHub é o ambiente de build)

1. ✅ **Feito.** O projeto foi enviado para `main` (`git push origin main`).
2. O workflow **`build`** roda automaticamente em `push`/`pull_request` para `main`,
   na matriz `ubuntu / windows / macos` × `node 22 / 24`, executando:
   `npm ci → lint → typecheck → test → build → smoke`. O `smoke` vem **depois** do
   `build` porque sobe `dist/core.mjs`, que só existe depois de ser construído.
   Acompanhe em: <https://github.com/xtrempkch-droid/nexus-agent-studio/actions>.
3. ✅ **Lockfile no lugar.** O `package-lock.json` está commitado na raiz e o
   `build.yml` usa `npm ci` + `cache: npm`.
4. Para **atualizar** o lockfile depois de mexer nas dependências, agora dá para
   rodar **localmente** `npm install --package-lock-only` (a máquina tem Node 22);
   como alternativa, **Actions → bootstrap-lockfile → Run workflow**. O download é um
   `.zip` — extraia e coloque o `package-lock.json` na **raiz do repo** (a mesma pasta
   do `package.json`; **nunca** em `.github/`). Antes de commitar, confira que
   `dependencies`/`devDependencies` do lockfile batem com o `package.json`, senão você
   fixa um lockfile defasado.

Verificação local (Node ≥ 22 disponível nesta máquina):

```bash
npm install
npm run lint && npm run typecheck && npm run test && npm run build
npm run smoke           # sobe dist/core.mjs e o dirige com um cliente MCP real
npm run dev:desktop     # UI em http://localhost:5173
node dist/core.mjs      # core como MCP server stdio
```

## 5. Próximos passos (ordem sugerida)

1. ✅ **Pipeline verde no run 37404728248** — os 6 jobs (ubuntu / windows / macos ×
   node 22 / 24) passaram em `npm ci`, `lint`, `typecheck`, `test`, `build` e `smoke`.
   Não há erro pendente no CI.
2. ✅ **Risco descartado com evidência — não reabra esta investigação.** Em
   `common/mcp/server.ts`, `build()` passa `inputSchema: tool.definition.inputSchema`
   (tipado como `z.ZodType`) para `McpServer.registerTool`, cuja assinatura v2 aceita
   `inputSchema?: StandardSchemaWithJSON | ZodRawShape`. Eu havia marcado isso como o
   ponto mais provável de falha; **o typecheck do run 37402173198 não acusou nada ali** —
   o `z.ZodType` do zod v4 satisfaz o `StandardSchemaWithJSON`. O cast `as never` do
   handler também está OK (`cb` aceita a união
   `ToolCallback<...> | LegacyToolCallback<ZodRawShape>`). **Nenhuma mudança necessária.**
3. ✅ **Vitest verificado.** O passo `Test` rodou pela primeira vez e passou. Isso é
   informativo por um detalhe do Vitest: com **zero** arquivos de teste descobertos ele
   **sai com código 1**, então o sucesso prova que os 8 arquivos foram encontrados e
   passaram. O CI, porém, não publica a contagem de testes — para vê-la, rode
   `npm run test` localmente.
4. ✅ **Lockfile commitado e CI endurecido** (`npm ci` + `cache: npm` de volta). O
   artefato veio do workflow `bootstrap-lockfile`, foi extraído, **validado contra o
   `package.json`** e só então commitado — commitar um lockfile defasado quebraria o
   `npm ci` justamente no passo que se queria endurecer.
5. ✅ **`Build (desktop)` no CI** (commit `29b9e0a`): o Vite agora empacota a UI de
   verdade. Resultado do run ainda não conferido (§3, linha 10).
6. 🟡 **O sidecar conversa MCP, com sessão longa. Falta ligar a UI.**
   `src-tauri/src/mcp.rs` faz `initialize`, `notifications/initialized`,
   `tools/list` e `tools/call`; `ShellState` mantém **uma** sessão, reutilizada e
   reiniciada se o processo morrer. O teste end-to-end sobe o core real e chama
   `read_file`, e a anotação do run confirma: `2025-11-25, 5 tools, tools/call ok`.

   **Próximos passos, em ordem:**
   - **(a) ✅ Fila de requisições — feita, ver §3 item 32.** `src-tauri/src/worker.rs`.
     O que **continua valendo** para quem escreve UI: a serialização do canal é
     obrigatória, então uma tool lenta ainda adia as seguintes — a fila melhora
     *onde* a espera acontece, não a torna grátis. Debounce e no máximo uma chamada
     em voo seguem sendo a regra (veja `flushEditorContext` em `App.tsx`).
   - **(b) ✅ Ligar a UI — feito na metade que não precisa de modelo.** Explorador,
     editor (gravando com Ctrl+S), shell interativo e execução de testes passam por
     `lib/coreClient.ts` até o core. O que sobrou é o **chat do agente**, e ele não é
     um problema de fiação: sem um LLM atrás não há o que ligar. Opções, em ordem de
     esforço: (i) apontar para um Ollama local (`http://localhost:11434`, que o modal
     de configurações já testa) e traduzir a conversa em chamadas `tools/call`;
     (ii) assumir que a janela é um cockpit sobre o core e transformar o chat em
     entrada de comandos direta. A decisão do transporte **está tomada e é
     reversível**: `app.withGlobalTauri` não adiciona dependência, então não mexe no
     lockfile, e migrar para `@tauri-apps/api` altera **um arquivo só**.
   - **(b2) O sandbox exige Docker, e Docker não está instalado nesta máquina.**
     `run_terminal_command` roda tudo em contêiner — é o isolamento prometido —,
     então sem Docker o terminal relata a recusa em vez de executar. O
     comportamento é o correto, mas significa que **hoje a única forma de um comando
     rodar é instalar Docker** (`sudo apt install docker.io`, depois
     `sudo usermod -aG docker $USER` e relogar). **Não** adicione execução local sem
     contêiner: isso desmontaria o isolamento, que é a razão de a tool existir.
   - **(c) Fazer o build chegar até o usuário.** O workflow `desktop-binary` monta
     e verifica o bundle, e **o Node agora viaja dentro dele** (`runtime/node`),
     então já não é preciso instalar Node na máquina de destino — `bridge.rs`
     prefere o runtime empacotado e cai no `node` do `PATH` só quando ele não
     existe. **Uso correto:** `bash RUN.sh ~/meu-projeto`, e é esse diretório que o
     editor abre — sem argumento o core cairia na pasta do bundle. **O que ainda
     falta a quem baixar:** WebKitGTK em runtime
     (`sudo apt install libwebkit2gtk-4.1-0`), e isso nenhum empacotamento
     substitui — a janela precisa dela.
   - **(d) Era moderna** da spec 2026-07-28, que exige o probe `server/discover` e
     metadados por requisição em `_meta`. Ao implementar, respeite a regra: cair
     para o `initialize` em **qualquer** erro não reconhecido, nunca em um código
     específico.

   - **(e) ✅ Ligar o chat a um modelo real.** `ollama` **já está instalado e
     rodando nesta máquina**,
     com `deepseek-r1:1.5b` local (1,1 GB, roda na CPU). A API foi verificada na
     documentação oficial: `POST /api/chat` com `stream: false` devolve objeto
     único, e `format: "json"` **força** saída JSON válida. **Decisão de desenho:**
     tool calling **por prompt** com `format: "json"`, e não o `tools` nativo — o
     nativo exige `parameters` em JSON Schema (que eu não quero fabricar a partir do
     Zod) e o `deepseek-r1:1.5b` quase certamente não tem template de tool calling,
     por ser um distill de R1. **O agente vive no core**, não na UI: o core já roda
     em Node com `fetch` embutido, então não há dependência nova nem o problema de
     CORS que o webview teria (o Tauri não está na lista de origens que o Ollama
     aceita por padrão).

   - **(f) ✅ Aprovação passo a passo.** Implementada: o modo Assistido pausa o
     loop antes de `write_file`/`run_terminal_command` (só mutação; leitura nunca
     pausa) e retoma **a mesma conversa** após aprovar/rejeitar, com o core sem
     estado — o turno pausado carrega o próprio `history` + tool pendente de
     volta, e `approveAll` equivale a autônomo. Ver §3 linha 23.

   Decisão registrada: **sidecar** (não reimplementar o core em Rust), preservando o
   `common/` headless. O custo é exigir um runtime Node na máquina, ou empacotar um.
7. Avaliar se o Monaco volta a ser usado (foi trocado por `<textarea>` para não
   adicionar dependência não verificada).

⏸️ **ADIADO — empacotar para Windows e macOS.** Decidido em 2026-10-07: deixar para
    quando o projeto estiver pronto. A análise fica registrada para não ser refeita
    do zero:
    - **Não é questão de custo** — o repositório é público, então os minutos do
      Actions são gratuitos em todos os sistemas.
    - **O obstáculo é a montagem do bundle**, que é shell POSIX: `apt-get` para as
      libs, `command -v node` (no Windows é `node.exe`), `chmod +x`, um `RUN.sh`
      com `readlink -f`/`[[ ]]`, `du -sh`/`ls -la`/`timeout` (coreutils) e
      `set -euo pipefail` — sendo que o shell padrão do runner Windows é
      PowerShell, então **todo** bloco `run: |` falharia. Não é "acrescentar um
      item à matriz": é uma **segunda implementação** do empacotamento.
    - **`--no-bundle` evita os ícones, e só existe um PNG.** `tauri.conf.json`
      aponta `icon: ["icons/icon.png"]`; não há `.ico` nem `.icns`.
    - **macOS tem duas arquiteturas.** `macos-latest` é ARM; um binário ARM não
      roda em Mac Intel. E binário baixado da internet é bloqueado por
      quarentena sem assinatura — `VERIFICATION REQUIRED` neste caso, não medido.
    - **O que já existe:** o workflow `build` roda `lint → typecheck → test →
      build → smoke` em ubuntu/windows/macos × node 22/24, então o **código** é
      verificado nas três. O que falta é o **pacote distribuível**. O Rust já é
      cross-platform (`shellArgv` tem ramo `win32`; `bridge.rs` omite `--user` no
      Windows; `main.rs` tem `windows_subsystem`).
    - **Caminho barato, se e quando voltar:** adicionar `windows-latest` e
      `macos-latest` ao `desktop-binary` só para **compilar** (`tauri build
      --no-bundle`, sem montar bundle nem publicar artefato). Provaria que o shell
      Tauri compila nos dois — verificação que hoje **não existe**.
8. ✅ **Aviso de depreciação resolvido.** `actions/checkout@v4`,
   `actions/setup-node@v4` e `actions/upload-artifact@v4` miravam o Node 20, deprecado
   nos runners. Todos foram para `@v5`, **depois de confirmar as tags** com
   `git ls-remote` (`checkout` 5.1.0, `setup-node` 5.0.0, `upload-artifact` 5.0.0).
9. *(Opcional)* `common/mcp/types.ts` exporta um `AnyToolHandler` que **colide de nome**
   com o `AnyToolHandler` exportado pelo SDK v2 (semânticas diferentes; não gera erro
   porque são namespaces distintos). Renomear o local para `ErasedToolHandler` reduz a
   ambiguidade para quem ler o código depois.
10. ✅ **Streaming da resposta do agente.** A resposta não chega mais de uma vez:
    o core agora faz `stream: true` (`llmClient.completeStream`, Ollama NDJSON /
    OpenAI SSE) e emite eventos de progresso (`answer_delta` + `tool_call`) pelo
    handler `onProgress` do loop. Esses eventos saem como notificações
    `notifications/agent/stream` — o `ctx.mcpReq.notify` do SDK v2, exposto aos
    handlers como um `ToolContext.notify` dependency-light em `server.ts` — e o
    sidecar Rust encaminha as mensagens **sem `id`** do stdout para a webview via
    um evento Tauri `agent-stream` (o leitor roteia notificações para um canal
    separado, então streaming nunca compete com a resposta pendente). A UI mostra
    um balão "thinking" que cresce com cada `answer_delta` e loga as tools no
    terminal conforme são chamadas. O `answer_delta.text` é o **preview completo**
    do `answer` extraído do JSON ainda incompleto (`answerPreview` em `agentLoop.ts`);
    o valor final continua vindo do parse completo. `complete` (não-streaming) foi
    preservado e testado como alternativa. **Verificado:** unit tests (137) +
    smoke; o round-trip da notificação foi provado por um probe stdio ad hoc; os
    módulos Rust (`mcp.rs`/`bridge.rs`, livres de Tauri) compilam e testam em
    isolamento (`cargo check`/`cargo test`); o `cargo check` completo do `main.rs`
    fica para o CI (exige as libs de sistema do Tauri).
11. ✅ **Escolha de projeto/pasta em runtime.** O workspace era fixado no start
    (via `NEXUS_WORKSPACE`/diretório de lançamento) e não havia como trocar de
    projeto com o app aberto. Agora `workspace_root` virou `Mutex<PathBuf>` no
    `ShellState` e dois comandos o alteram: `pick_workspace` abre o diálogo
    nativo de pasta (`tauri-plugin-dialog`, chamado **do Rust** — sem dependência
    npm, não toca o lockfile) e `set_workspace` aceita um caminho digitado; ambos
    passam por `switch_workspace`, que canoniza o caminho, valida que é diretório,
    derruba o core atual e deixa o próximo uso reiniciá-lo lazy no novo diretório.
    Na UI há botão **"Abrir projeto"** no cabeçalho e no explorador, e um campo
    **"Pasta do projeto"** nas configurações. Ao trocar, a UI reseta arquivos,
    abas, explorer, diagnósticos e terminais (o histórico do chat é mantido — é da
    sessão, não do projeto). `workspace_info` passou a devolver `Result` e ler do
    mutex. **Verificado:** lint/typecheck/test/build:desktop verdes + teste no
    navegador; o `cargo check` completo do `main.rs` (inclui o plugin de diálogo)
    fica para o CI, que já instala as libs GTK necessárias.
12. ✅ **Escolha livre de modelo.** O seletor do cabeçalho era um `<select>`
    fechado que só listava os modelos devolvidos por `list_models`. Agora é um
    **texto livre** (`<input list=…>` + `<datalist>`): o usuário digita qualquer
    nome de modelo (ex.: `qwen2.5:7b`, `gpt-4o`, `llama3.2`) e a lista
    sincronizada vira apenas autocomplete. O painel de configurações ganhou o
    campo **"Modelo ativo (nome livre)"** com o mesmo estado, e o rodapé do chat
    mostra o nome digitado. Nada no core mudou — `ask_agent` já aceitava `model`
    como string livre; a restrição era só de UI.
13. ✅ **`.gitignore` no `list_directory`.** A lista fixa de diretórios excluídos
    (`DEFAULT_EXCLUDED_DIRECTORIES`) era a "resposta errada certa": não sabe que
    um projeto guarda código em `target/`. Agora o walk **também** honra
    `.gitignore` — novo `common/mcp/tools/gitignore.ts` com parser e matcher de um
    **subconjunto documentado** da semântica do git (comentários, `*`/`?`/`**`/
    `[...]`, `/` final = só diretórios, `/` inicial ou medial = ancorar ao
    diretório do arquivo, `!` de negação, "última regra vence", escapes `\#`/`\!`/
    `\ `). O `list_directory` carrega o `.gitignore` da raiz e, ao descer, empilha
    os `.gitignore` aninhados (deeper vence), aplicando-os só às entradas **abaixo**
    do diretório inicial — listar um diretório ignorado explicitamente continua
    funcionando, igual à lista fixa. A lista fixa **permanece** como default
    complementar (`.git` etc. nem sempre estão no `.gitignore`). **Verificado:**
    `gitignore.test.ts` (11 casos) + 2 casos de integração em `fileTools.test.ts`;
    150 testes no total, smoke verde.
14. ✅ **LSP bridge completo.** Diagnósticos reais de linguagem chegam à UI.
    - **Core** (`common/lsp/`): framing do base-protocol (spec 3.17),
      `diagnostics.ts` (LSP → `InlineHint`, confinado ao workspace),
      `lspClient.ts` (JSON-RPC agnóstico de transporte), `stdioTransport.ts`
      (processo filho) e `languageService.ts` (ciclo de documento +
      `publishDiagnostics` → `InlineHintManager`).
    - **Orquestração** (`common/lsp/languageServerManager.ts`): servidores por
      linguagem, início **lazy** na primeira verificação, `refresh` que abre/atualiza
      o arquivo e **aguarda** o push de diagnósticos (com timeout), reconfiguração
      que derruba o servidor em execução.
    - **Tools MCP** (`common/mcp/tools/lspTools.ts`): `configure_language_server`,
      `list_language_servers` e `get_diagnostics` (com `path` faz refresh e devolve
      o arquivo; sem `path` devolve todos). A surface passou de **7 → 10 tools**.
    - **Config**: `NEXUS_LSP_SERVERS` (JSON) no bootstrap; `CoreOptions.languageServers`.
    - **UI**: botão **"Verificar"** no cabeçalho, verificação automática ao abrir e
      ao salvar, seção **"Servidores de linguagem (LSP)"** nas configurações, e
      `get_diagnostics` ligado ao gutter via `coreClient.ts`. O store de hints é
      único: diagnósticos do compilador (via `run_terminal_command`) e do LSP
      aparecem juntos.
    **Verificado:** 204 testes (era 193; +11 entre manager e tools), smoke com
    `get_diagnostics`, e um **e2e sobre MCP** (script ad hoc) que configura um
    servidor LSP filho real, faz refresh de um arquivo e recebe o diagnóstico com
    linha 1-based e `source: lsp:<id>` — `LSP E2E OK`. O CI cobre o resto (build +
    tauri com a lista de 10 tools atualizada).
15. ✅ **Ajustes de UI/UX após rodar o app executável.** Resultados de usar o
    programa compilado:
    - **Modal de configurações crescia além da tela** quando a lista de modelos
      aparecia, empurrando "Salvar e Fechar" para fora. Agora é uma coluna flex
      com `max-h-[90vh]`, corpo rolável (`overflow-y-auto`) e rodapé fixo.
    - **"Abrir" só abria pastas.** Agora há dois botões explícitos, **"Pasta"** e
      **"Arquivo"**, e um comando `pick_file` no shell: ao escolher um arquivo, o
      workspace é reapontado para a pasta dele e o arquivo volta como caminho
      relativo — abrir um arquivo solto virou "abrir a pasta dele e focar o arquivo".
    - **"Novo arquivo" não fazia nada.** O `+` do explorador abre um prompt inline
      de nome e cria o arquivo no diretório em exibição (via `write_file`).
    - **Espera longa parecia travamento.** O chat mostra um spinner com **segundos
      decorridos** enquanto aguarda, e o teto de tempo por chamada de tool no shell
      subiu de **120 s → 600 s** — um modelo local lento vira espera, não erro de
      timeout. (O `run_terminal_command` mantém o próprio `timeoutMs`.)
16. ✅ **Janela "não está respondendo" no Linux resolvida.** Causa raiz: no Tauri,
    um comando **síncrono** roda na **main thread**, e `call_core_tool` segurava a
    chamada por todo o tempo do modelo — minutos num modelo local. Isso congela o
    loop do WebKitGTK, e o ambiente gráfico rotula a janela como "not responding".
    (Fonte: doc oficial do Tauri v2 — *"Asynchronous commands are preferred… If
    your command needs to run asynchronously, simply declare it as async"*.)
    `call_core_tool`, `core_handshake`, `core_boot_probe` e `set_workspace` agora
    são `async` e rodam o trabalho bloqueante via
    `tauri::async_runtime::spawn_blocking` (API confirmada no fonte do Tauri), então
    a main thread fica livre e a espera longa não congela mais a janela. Também
    adicionado um botão **"Salvar"** visível na barra de abas do editor (antes só
    havia Ctrl+S). **Lição para futuras fatias:** no shell, qualquer comando que
    faça I/O bloqueante (stdio do core, espera de diálogo, shutdown) tem de ser
    `async` + `spawn_blocking`; comando síncrono é só para trabalho instantâneo.

17. ✅ **`get_editor_context` alimentado pela UI.** A tool existia desde a fase 2,
    mas reportava sempre o estado vazio porque nada escrevia no store: a UI nunca
    enviava cursor/seleção ao core (mesma classe de lacuna que o LSP tinha). Agora
    o par está completo — `set_editor_context` (a UI conta o que está na tela) e
    `get_editor_context` (o agente pergunta). A surface foi de **10 → 11 tools**;
    as três listas que a asseguram (`common/core.test.ts`, `scripts/smoke-mcp.ts`,
    o e2e em `src-tauri/src/mcp.rs`) foram atualizadas junto.
    - **Core** (`common/mcp/tools/editorTools.ts`): patch **parcial** — campo omitido
      mantém o valor anterior; `null` explícito é um valor (é assim que a seleção é
      limpa); `languageId` é **derivado** de `activeFile` no core quando omitido,
      porque o mapa de extensões mora num lugar só (`common/lsp/languageService.ts`)
      e a UI só pode importar *tipos* do core. Fechar o arquivo limpa o `languageId`.
    - **UI** (`variants/desktop/src/App.tsx`, `lib/coreClient.ts`): o editor reporta
      com **debounce de 400 ms** — o caret muda a cada tecla, o valor só precisa ser
      o último. O caret vive num **ref**, não em estado, para não re-renderizar a
      cada tecla; `onSelect`/`onClick`/`onKeyUp`/`onChange` capturam posição e
      seleção (offset → linha/coluna 1-based). Abrir outro arquivo zera o caret (a
      posição do arquivo anterior não existe no novo), o relatório é reenviado
      quando o handshake completa, e falha é silenciosa — no browser não há core.
    - **Um relatório por vez, coalescido** (correção após revisão): toda chamada de
      tool **serializa na única sessão do core** (`with_core` segura o `Mutex`), e
      `ask_agent` segura essa sessão por todo o tempo do modelo. Um relatório
      enviado durante um turno **espera** ali — então um relatório por tecla
      empilharia uma thread de blocking pool bloqueada por relatório até o turno
      acabar. Agora só existe **um em voo**: o estado mais recente espera a
      resposta anterior e um único relatório final é enviado, o que mantém o core
      atualizado sem enfileirar nada. (Issue de fundo: §5 item 6-a, fila no sidecar.)
      **A/B medido no browser** (stub com latência de 2 s simulando o mutex preso,
      10 teclas): antes **11 envios com até 4 simultâneos**; depois **4 envios, máx.
      1**, e o último relatório resolvido bate com o cursor do DOM — coalescer não
      perde o estado final.
    **Verificado:** 214 testes (eram 204; +10 em `editorTools.test.ts`), o smoke com
    o **round-trip `set_editor_context` → `get_editor_context`** sobre stdio real, e
    no browser com um `window.__TAURI__` **stubado** registrando as chamadas:
    relatório ao conectar, seleção (`{start,end}` + cursor), debounce (N teclas → 1
    envio) e `dirty: true` ao editar.
18. ✅ **Aba do editor fecha, e o agente ganhou orçamento configurável.** Depois de
    usar o programa: faltava um botão para fechar a aba, e a IA "não tinha tempo de
    criar os arquivos". Havia **dois** tetos fixos, e os dois apareceram na mesma
    reclamação:
    - **Tempo** — o shell esperava 600 s por uma chamada de tool e não havia como
      aumentar. `call_core_tool` agora aceita `timeoutSeconds` opcional, com o clamp
      (10 s … 24 h) num lugar só, `mcp::tool_timeout` — o valor vem de um campo que
      uma pessoa digitou, e os dois extremos são falhas reais: curto demais e nem
      `tools/list` termina; longo demais e um core travado segura a sessão (e a UI
      que espera por ela) para sempre.
    - **Passos** — o loop rodava no máximo **6** idas e voltas ao modelo e o
      `ask_agent` **não oferecia** como mudar isso. Seis serve para uma pergunta e é
      apertado para "crie estes arquivos", onde cada arquivo é **uma** chamada de
      tool mais a rodada que as pede — exatamente o formato de tarefa que estava
      ficando pela metade. O schema agora expõe `maxSteps` (1…50, padrão 6, vindo de
      `DEFAULT_MAX_STEPS`/`MAX_MAX_STEPS` exportados) e o loop clampa de novo para
      quem o chama direto (teste, plugin).
    - **UI**: botão **X** em cada aba (dois botões irmãos, não um dentro do outro —
      aninhar é HTML inválido e o clique cai no alvo errado), fechando a última aba o
      editor esvazia em vez de continuar mostrando arquivo fechado, e o registro do
      arquivo fica em `files` de propósito (pode haver edição não salva; descartá-la
      por um clique errado é pior). Nas configurações, seção **"Tempo do agente"**
      com os dois campos, commits **no blur** (clampar a cada tecla transforma "600"
      em "10" no primeiro dígito) e mostrando o valor que será usado de fato. O
      erro de timeout agora diz **qual configuração** aumentar e o valor em vigor.
    - **Correção de quebra encontrada no teste:** uma resposta de `get_diagnostics`
      sem o campo `diagnostics` espalhava `undefined` e derrubava a tela inteira
      (branca). Lista vazia é a leitura honesta de "sem diagnósticos".
    **Verificado:** 227 testes (eram 225; +2 em `agentTools.test.ts`) e, no browser
    com `window.__TAURI__` stubado: fechar a aba ativa passa para a vizinha (e a do
    meio passa para a que toma o lugar), 0 abas → editor vazio e **Salvar
    desabilitado**, campos com padrão 600/6, clamp 1/50 para passos, e o repasse
    chegando como `timeoutSeconds: 1800` **no comando** (fora dos argumentos da tool)
    e `maxSteps: 20` **nos argumentos**. A mensagem de timeout foi conferida
    injetando a falha do shell.
    **O clamp do tempo mudou no item 20:** o mínimo agora é **0**, que significa
    esperar sem limite.
19. ✅ **O agente parou de mentir sobre o que aconteceu** — e a causa real de "a IA
    não cria os arquivos" apareceu. Primeira vez que o loop foi exercitado com
    **modelo real** (Ollama nesta máquina; a §2 dizia "não rodado contra o modelo").
    Três defeitos, todos visíveis num único traço:
    - **Erro repetido queimava o orçamento.** O `qwen2.5-coder:3b` inventou
      `contents` para `content`, chamou `write_file` **6 vezes com o mesmo erro** e o
      turno terminou dizendo "atingiu o limite de passos". Agora **uma** repetição
      idêntica é permitida (um timeout pode passar na segunda) e a **segunda** igual
      encerra o turno explicando o porquê — a evidência de que repetir não resolve.
    - **O feedback não era acionável.** A mensagem de validação nomeia o campo
      **ausente** (`content: expected string, received undefined`), o que não bastou
      para o modelo se corrigir. O loop agora recebe os nomes de argumentos **do
      próprio schema Zod** (§5 item 18, `parameterNamesOf`) e diz "a ferramenta
      espera exatamente estes argumentos: path, content".
    - **"Não concluiu" era mentira às vezes.** Com `llama3.2:latest` o agente
      **escreveu os 3 arquivos** e depois divagou (`list_models`, um `docker run`
      inútil) até o orçamento acabar — o usuário era informado de que a tarefa não
      concluiu **com os arquivos no disco**. Agora a mensagem final lista as
      ferramentas que responderam e só culpa uma falha quando ela foi realmente a
      **última** coisa que aconteceu (um erro do qual o modelo já se recuperou
      apontaria a correção errada). Quando a última chamada falhou, as **duas**
      leituras são oferecidas em vez de adivinhar ("talvez só precisasse de mais
      passos; se o erro se repetir sempre, aumentar não resolve"); a afirmação forte
      fica só na guarda de repetição, onde a evidência existe.
    **Verificado:** 235 testes (eram 233; +2 e mais 4 reescritos), e **com modelos
    reais**: `llama3.2:latest` criou 2 dos 3 arquivos e esgotou os passos no meio da
    exploração — a mensagem nova relata isso exatamente; `qwen2.5-coder:3b` mostrou
    os dois modos de falha (o `contents` inventado e responder em prosa sem chamar
    ferramenta). **Conclusão útil para o usuário:** com o padrão de 6 passos, criar 3
    arquivos fica no limite — a configuração do item 18 é o que resolve.
20. ✅ **`0` no tempo do agente = esperar sem limite.** Ajuste pedido depois de usar o
    programa: mesmo 600 s não bastam para um modelo local, e o resultado parecia
    configuração quebrada. O mínimo do campo agora é **0**, e **0 significa sem
    prazo** — espera o quanto o modelo precisar.
    - **O shell representa isso honestamente, não com um número gigante:**
      `mcp::tool_timeout` devolve `Option<Duration>` e a espera usa `recv()` sem
      prazo em vez de `recv_timeout`. Um sentinela grande seria uma mina — `Instant +
      Duration::MAX` entra em pânico — e ainda seria um prazo, só distante.
    - **Duas assimetrias deliberadas:** valor **ausente** continua sendo o padrão
      (um cliente que não diz nada não deve travar para sempre num core emperrado),
      e valor **positivo pequeno** continua subindo para 10 s — alguns segundos não é
      timeout, é falha garantida (nem `tools/list` termina). O campo explica as duas
      e mostra **"sem limite de tempo"** em vez de "0.0 min".
    - **Custo conhecido:** com 0 não há como destravar um turno pela UI, e
      `ShellState::with_core` segura o `Mutex` durante a chamada — se o core emperrar,
      só reiniciando o app. É aceitável porque é uma escolha explícita do usuário e
      está escrito no próprio campo; a solução de fundo é a fila do §5 item 6-a.
    **Verificado:** 235 testes (o caso do `tool_timeout` foi reescrito para cobrir
    `Some(0) → None`, `None → 600 s`, e os dois clamps) e, no browser com o shell
    stubado: padrão `600` com "10.0 min", `0` → campo mostra `0` e o rótulo vira
    **"sem limite de tempo"**, `-5` → `0`, `5` → `10`, `min="0"` no input, e o
    pedido sai com **`timeoutSeconds: 0`** — o que o shell traduz em `Some(0)`.

---

**Ao retomar.** Última sessão (2026-10-06) entregou, em PRs mergeados: **streaming**
do agente (#1), **seletor de modelo livre** (#2), **abrir projeto/pasta/arquivo** (#3),
**`.gitignore`** no explorador (#4), **LSP completo** (#5, #6), **ajustes de UI** e a
correção do **travamento da janela** (#7, #8 — `async` + `spawn_blocking`), o
**contexto do editor** alimentado pela UI com coalescência (#8, #9), o **sandbox
Docker funcionando de fato** (#10 — dois bugs reais: argv sem o binário `docker` e
container rodando como root), as **abas fecháveis + orçamento do agente** (#11) e o
**relato honesto das falhas do turno** (#12). Nesta fatia: **`0` = esperar sem
limite** no tempo do agente (item 20).

**Estado:** `main` verde, 235 testes, `cargo check`/`cargo test` verdes no CI. O
**sandbox compila e roda C de verdade**; o **agente foi exercitado contra modelos
reais** (Ollama local) — foi assim que os defeitos dos itens 19 e 20 apareceram.

**O que falta, em ordem de valor:**
0. ⏳ **PERFILAR A MÁQUINA A — tarefa em aberto, e a única que eu não consigo
   fechar.** Bloqueada porque o dono não tem acesso a essa máquina no momento
   (2026-10-07); **qualquer IA que trabalhe lá** deve rodar
   `sh scripts/env-probe.sh`, ver o bloco `THIS MACHINE IS NOT PROFILED` que o
   probe imprime, e preencher `docs/MACHINES.md`. **Por que isso é mecânico e não
   um lembrete:** o probe lê o próprio `machine-id` e procura no
   `docs/MACHINES.md`; se não achar, ele mesmo pede — então a tarefa sobrevive à
   sessão que a pensou, e não depende de ninguém ler uma lista. É o que decide se
   build, teste e Docker rodam localmente naquela máquina ou vão para o CI.
   **Não preencher por suposição:** os campos são medições, e "a máquina tem
   suporte a tudo" é relato, não medida.
1. **Reconstruir o `.exe` e usar o programa** — é a verificação que fecha o ciclo e a
   única que pode revelar o que o browser stubado não revela. Todas as correções
   estão em `main`, mas o binário que existe é anterior a elas.
2. ✅ **Fila de requisições — FEITA** (§3 item 32). `src-tauri/src/worker.rs` tem
   **uma thread dona da sessão**: nada é segurado durante a chamada, os pedidos são
   atendidos em ordem de submissão (FIFO), e o orçamento conta desde a submissão.
   O que **continua valendo** para quem escreve UI: o canal ainda é serializado,
   então uma tool lenta adia as seguintes — debounce e no máximo uma chamada em voo
   seguem sendo a regra. **Não** existe cancelamento: um pedido abandonado continua
   rodando no core e o próximo espera por ele.
3. **Era moderna da spec 2026-07-28** (`server/discover` + `_meta`, §3 item 6-d).
4. **WASM** para `common/` (exige auditoria DOM-free).
5. Não priorizados: plugin marketplace com assinatura, MCP remoto via Streamable
   HTTP, integração DAP.

**Armadilhas já pagas** (leia antes de mexer): `AGENTS.md` (invariantes) e as linhas
do §3 — em especial 24 (CI "parado" era branch mergeado sem evento), 25–26 (argv do
sandbox e root no container: **teste com dublê não pega contrato de argv**) e 27–28
(as duas limitações deste host). Ver também
`/memories/repo/build-and-verify.md`.

## 6. Decisões e correções em relação ao prompt original

O prompt original continha afirmações **incorretas** que foram verificadas contra
o registro npm e a documentação oficial e corrigidas. **Não reintroduza essas
afirmações.**

| Afirmação original | Realidade verificada (2026-10-05) | O que foi feito |
| --- | --- | --- |
| React `^20.x` | Não existe. `latest` = **19.3.0** | Usado `^19.3.0` |
| Tailwind `^5.x` | Não existe. `latest` = **4.3.3** | Usado `^4.3.3` (o `@theme` CSS-first é recurso do **v4**) |
| `serveStdio(server)` | `serveStdio` recebe uma **factory** `() => McpServer` | `serveStdio(() => this.build())` |
| Docker 29.4.2 por CVE-2026-31431 | A CVE é real (`algif_aead`, CVSS 7.8, CISA KEV) mas a correção é **patch de kernel**; o perfil seccomp padrão do Docker **já** bloqueia `AF_ALG` | Isolamento por flags + seccomp padrão; versão do Docker fixada só por reprodutibilidade |
| `@typescript/native` | Não é publicado; o pacote real é **`@typescript/native-preview`** | Não usado como dependência |
| TypeScript `^7.0.2` como dependência | Existe (latest = 7.0.2), mas **é incompatível com `typescript-eslint@8`**, que exige `<6.1.0` → `ERESOLVE` e `npm install` aborta | Prendido em `~6.0.2` (= `>=6.0.2 <6.1.0`), que satisfaz o peer e fornece o `tsc` |
| Vitest `^4.x` | `latest` = **5.0.3** (`V4` = 4.1.11) | Usado `^5.0.3` |
| Node matrix 22/24/**26** | Node 26 não confirmado | Matriz só com **22 / 24** |

Confirmado como **correto** no prompt: pacotes `@modelcontextprotocol/server` e
`/client` v2 (2.3.1), `@modelcontextprotocol/sdk` é o v1 legado (não usar),
`import * as z from 'zod/v4'`, `registerTool(name, {description, inputSchema}, handler)`,
`@typescript/typescript6` **existe** (6.0.2 — mas expõe o binário `tsc6`, não `tsc`),
esbuild 0.28.2, ESLint 10.x. E o padrão de alias para coexistência de duas versões de
TypeScript descrito no prompt é real: o próprio `typescript-eslint@8.71.1` usa
`"@typescript/native": "npm:typescript@^7.0.2"` junto de `"typescript": ">=4.8.4 <6.1.0"`.

## 7. Invariantes do código (não viole)

- `common/` **nunca** importa DOM/React nem `window`/`document` (precisa compilar para WASM).
- `stdout` é o canal JSON-RPC do MCP: só `console.error` para log.
- Imports relativos levam extensão explícita (`.ts` / `.tsx`) → exige
  `allowImportingTsExtensions: true` + `noEmit: true`.
- `moduleResolution: "bundler"` + `module: "ESNext"`; **`baseUrl` é proibido**
  (deprecado no TS 7, para de funcionar). Valores de `paths` levam prefixo `./`.
- `variants/desktop` só pode importar **tipos** do core (`import type`), nunca valores.
- O registro de tools é *type-erased*: `AnyToolHandler` (`any`, documentado) para
  armazenamento; as APIs públicas permanecem genéricas para o handler inferir os
  argumentos de `inputSchema`. Desestruturar `unknown` falha sob `noImplicitAny` — é por isso.
- `@core/*` → `./common/*`.

## 8. Protocolo de manutenção deste arquivo

Ao terminar qualquer mudança relevante:

1. Atualize **§2** (status) e **§5** (próximos passos).
2. Atualize a linha **"Última atualização"** no cabeçalho (o hash do commit é
   obtido com `git log -1 --oneline`, nunca fixado no texto — ficaria defasado).
3. Se uma decisão de stack mudar, registre em **§6** com a fonte oficial.
4. Se um invariante mudar, atualize **§7** e o relatório equivalente em `AGENTS.md`.
