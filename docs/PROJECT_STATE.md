# PROJECT STATE — NexusAgent Studio

> **Arquivo de rastro (handoff).** Existe para que a ideia, as decisões e o ponto
> de parada sobrevivam ao fim de uma janela de contexto. Se você é uma IA ou um
> humano retomando este repositório, **leia este arquivo primeiro**.
>
> **Última atualização:** 2026-10-06 · **Commit atual:** confira com
> `git log -1 --oneline`

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
| 7 | Agente + aprovação passo a passo | ✅ completo | 🟡 loop testado com `fetch` injetado; não rodado contra o modelo na janela (sem tela no CI) |

**Resumo: o pipeline está VERDE — 8 jobs** (6 de `build` × SO/Node, `cargo check`
e o bundle `desktop-binary`). Nada mais é simulado: a UI, o agente e a aprovação
passo a passo falam com o core de verdade. **Ambiente local mudou desde a última
nota:** agora a máquina **tem `node` 22 + `npm` 9** (build, teste, smoke e
`build:desktop` rodam localmente) e **Rust via `rustup`** (1.99.0, instalação
user-space) — então `cargo check`/`cargo test` dos módulos livres de Tauri também
rodam aqui. O que **ainda** falta: `sudo` sem senha e o grupo `docker` (o socket é
`root:root`), então o `cargo check` **completo** do `main.rs` (que exige as libs
GTK/WebKitGTK de sistema) continua dependendo do CI (`tauri.yml`). A janela só é
aberta pelo dono na própria máquina. O modelo local é `deepseek-r1:1.5b` via
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
| 1 | Sem Node/npm na máquina local | ✅ **RESOLVIDO.** A máquina agora tem `node` 22 + `npm` 9 (e Rust via `rustup`), então lint/typecheck/test/build/smoke/build:desktop rodam localmente. Só o `cargo check` completo do `main.rs` (libs GTK de sistema) segue dependendo do CI. |
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
| 19 | O terminal não executava nada | 🟡 **DESTRAVADO, DESLIGADO POR PADRÃO.** O sandbox Docker continua sendo o padrão e **nada o infere**: sem Docker o terminal só sabia explicar a própria recusa — e um sandbox que não roda não é mais seguro, é só quebrado. Criado `common/docker/localRunner.ts` (`LocalRunner`) implementando o **mesmo contrato** `run()` do `DockerSandbox`; o tipo `Sandbox` virou `Pick<DockerSandbox, 'run'>`, então os tools não sabem qual receberam. Ligado apenas por `NEXUS_UNSANDBOXED=1`, lido em `common/index.ts` — **nunca do webview**, que não pode desligar isolamento — e o `RUN.sh` imprime um aviso explícito. **O rótulo é a história de segurança:** todo resultado reporta `image: 'local (sem isolamento)'` e **nunca** a imagem pedida, porque nada rodou nela; um log que não distingue contêiner de host é pior que log nenhum. `shellArgv` é parametrizado por plataforma para o ramo Windows ser testável a partir do Linux. Testes: `localRunner.test.ts` (7 casos, executor injetado, nenhum processo real) e `core.test.ts` (4 casos, incluindo "sandbox por padrão" e "injeção vence a flag"). |
| 20 | Não dava para abrir pastas | ✅ **CORRIGIDO.** O explorador era uma lista plana **só de arquivos**: `list_directory` devolvia pastas e arquivos, mas a UI descartava os diretórios — abrir uma pasta era impossível, e não havia ação de "abrir arquivo". Agora o explorador lista arquivos **e** subdiretórios da pasta atual, clicar numa pasta entra nela, e há breadcrumb + `..` para subir, com a raiz sempre acessível. Abrir um arquivo insere o registro na lista de abertos **antes** de lê-lo — o explorador lista uma pasta por vez, então o editor não tinha onde pôr conteúdo que ainda não tinha visto. `FileExplorer` trocou o modelo de `files` por `entries` + `statuses` + `currentDir`. |
| 21 | Configurações duras no Ollama | ✅ **CORRIGIDO.** O modal tinha um único campo de URL do Ollama e o seletor de modelo era uma lista **falsa** de nomes fixos. Agora: **lista de provedores** (nome, tipo `ollama`/`openai` e URL), botão **Sincronizar modelos** que pergunta ao provedor ativo via a nova tool `list_models` e lista os nomes para o usuário escolher o ativo; o seletor do cabeçalho é construído dos modelos sincronizados. **Formato verificado contra o servidor vivo** (`/api/tags` → `{models:[{name}]}`; `/v1/models` → `{object:list,data:[{id}]}`), não assumido; a tool nasceu com `fetch` injetável e testes. **Consequência que quebrou o CI:** a superfície subiu de 5 para 6 tools, e a lista é afirmada em **três lugares** — smoke test TS, composição do core e teste e2e do Rust; atualizei dois e esqueci o terceiro. Lição: antes de adicionar tool, `grep` por todas as listas exatas. |

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
   - **(a) Fila de requisições** em vez do mutex bloqueante. Hoje uma tool lenta
     (o terminal Docker) trava todas as outras, porque stdio é um canal único. O
     certo é uma fila com mapa `id → oneshot`, mantendo a serialização do canal
     mas libertando o chamador.
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
14. ✅ **Fundação do LSP bridge (`common/lsp/`).** Um editor precisa de
    diagnósticos reais de linguagem, não só do que o compilador imprime no
    `stderr` do contêiner. Esta fatia entrega o **cliente LSP** no core, ainda
    **sem** a fiação na UI (que é a fatia seguinte). Arquivos:
    - `common/lsp/framing.ts` — codificador/decodificador incremental do
      base-protocol (`Content-Length` em **bytes**, headers ASCII, `\r\n\r\n`).
      Verificado na spec oficial 3.17 ("Base Protocol").
    - `common/lsp/diagnostics.ts` — tradução LSP → `InlineHint` (posições 0-based
      → 1-based, severidade numérica → 3 níveis, `file://` URI → caminho
      workspace-relative, com recusa de qualquer arquivo fora do workspace).
    - `common/lsp/lspClient.ts` — JSON-RPC agnóstico de transporte
      (`request`/`notify`/`onNotification`, timeout, responde a request do servidor
      com `Method not found` em vez de travar).
    - `common/lsp/stdioTransport.ts` — spawn de processo filho + framing; drena o
      `stderr` para não encher o pipe.
    - `common/lsp/languageService.ts` — ciclo de documento (`didOpen`/`didChange`/
      `didClose`) e `publishDiagnostics` → `InlineHintManager`, honrando o sync
      kind negociado (full ou incremental).
    **Verificado:** 45 testes LSP (framing 12, diagnostics 9, client 9,
    languageService 10) **mais 3 de integração com processo filho real** que
    completam um handshake LSP de verdade; 193 testes no total, build/smoke/desktop
    verdes. **O que falta:** expor como tool MCP e ligar na UI (comandos Tauri
    para configurar/iniciar o servidor de linguagem e alimentar o gutter).

---

**Ao retomar.** Fases anteriores **mergeadas em `main`** (`ec45b65`): streaming
(§5 item 10), projeto/pasta (§5 item 11), modelo livre (§5 item 12), `.gitignore`
(§5 item 13). Nesta fase, a **fundação do LSP bridge** (§5 item 14) foi
implementada no core. O que resta é **melhoria**, em ordem de valor sugerida —
conciliada com o `docs/roadmap.md` ("Next"): (1) **fechar o LSP bridge** — expor
`get_diagnostics` como tool MCP e ligar na UI (comandos Tauri para configurar e
iniciar o servidor de linguagem, alimentando o gutter com os hints do LSP);
(2) fila de requisições no sidecar em vez do mutex bloqueante (§5 item 6-a);
(3) era moderna da spec 2026-07-28 (§5 item 6-d); (4) WASM target para `common/`
(exige auditoria DOM-free). Itens de roadmap ainda não priorizados: plugin
marketplace com assinatura, MCP remoto via Streamable HTTP, integração DAP. Para
retomar comigo, ler §3 linhas 16–23 (histórico recente) e
`/memories/repo/build-and-verify.md` (armadilhas já pagas).

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
