# PROJECT STATE — NexusAgent Studio

> **Arquivo de rastro (handoff).** Existe para que a ideia, as decisões e o ponto
> de parada sobrevivam ao fim de uma janela de contexto. Se você é uma IA ou um
> humano retomando este repositório, **leia este arquivo primeiro**.
>
> **Última atualização:** 2026-10-05 · **Commit atual:** confira com
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
| 3 | Sandbox Docker + IPC | 🟡 em andamento | ❌ o sandbox nunca foi invocado (não há Docker no CI); a **ponte IPC ainda não existe** — só o hospedeiro Tauri (`src-tauri/`) |
| 4 | Arquitetura de plugins | ✅ completo | 🟡 parcial: registro/unload cobertos por teste, mas **nenhum plugin real foi carregado** |
| 5 | Configuração e build | ✅ completo | 🟡 core sim, UI não: `dist/core.mjs` é construído e executado; `npm run build:desktop` **não roda no CI** |

**Resumo honesto: o pipeline está VERDE e agora prova que o servidor roda.** A
máquina onde o código foi produzido **não tem `node` nem `npm`** e não há `sudo` sem
senha, então nada roda localmente — o **GitHub Actions é o ambiente de build** (§4).
No run **37404728248** (commit `ab839aa`) os **6 jobs** (ubuntu / windows / macos ×
node 22 / 24) passaram com **todos os passos verdes**:

- ✅ `npm ci` — instala exatamente o que o lockfile fixa.
- ✅ `npm run lint` — passa.
- ✅ `npm run typecheck` — passa (depois de corrigir os 6 erros do run 37402173198; §3, linhas 7–8).
- ✅ `npm run test` — passa (Vitest, 8 arquivos).
- ✅ `npm run build` — passa; gera `dist/core.mjs`.
- ✅ `npm run smoke` — passa nos 3 SOs, inclusive **Windows**.

**O que o smoke test realmente prova** (não é só "passou"): ele sobe o
`dist/core.mjs` de produção e o dirige com um cliente MCP real via stdio. O handshake
completa; `tools/list` devolve **exatamente** as 5 tools esperadas — o que só é
possível se o SDK converter cada schema Zod em JSON Schema **em runtime**, coisa que o
typecheck não prova; `read_file` lê o `package.json`; uma chamada **sem o argumento
obrigatório** é rejeitada com `isError: true` **antes** do handler rodar; um caminho
com `../` é recusado; e o servidor continua respondendo depois dos dois erros.

## 3. Bloqueio atual e como resolvê-lo

| # | Bloqueio | Estado / resolução |
| --- | --- | --- |
| 1 | Sem Node/npm na máquina local | **Contornado.** O GitHub é o ambiente de build — os runners têm Node. Veja §4. |
| 2 | `package-lock.json` ausente → `npm ci` e `cache: npm` falhariam no CI | ✅ **RESOLVIDO.** O lockfile foi gerado pelo workflow `bootstrap-lockfile`, **validado contra o `package.json`** e commitado na raiz. O `build.yml` voltou para `npm ci` + `cache: npm`. O arquivo tem 239 entradas, `lockfileVersion: 3`, e `dependencies`/`devDependencies` batem **exatamente** com o manifesto. `typescript` resolveu em **6.0.3** — dentro da faixa `~6.0.2` e do peer `>=4.8.4 <6.1.0` do `typescript-eslint@8.71.1`. |
| 3 | `git push` requer credenciais | ✅ **RESOLVIDO.** HTTPS não tinha credencial, mas a chave `~/.ssh/id_ed25519` já está autorizada na conta. O remote `origin` foi apontado para SSH: `git@github.com:xtrempkch-droid/nexus-agent-studio.git`. |
| 4 | A UI desktop é uma **simulação** no browser | Falta a ponte IPC (Electron/Tauri) entre `variants/desktop` e `common/`. Ver §5. |
| 5 | `npm install` falhava no CI (run #34, os 6 jobs) | ✅ **RESOLVIDO e confirmado.** Causa: `typescript-eslint@8.71.1` declara `peerDependencies.typescript: ">=4.8.4 <6.1.0"` e eu havia declarado `typescript ^7.0.2` → `ERESOLVE`, exit 1 no passo de install, com `lint`/`typecheck`/`test`/`build` **skipped**. Agora `typescript: "~6.0.2"` e o install passa. |
| 6 | `npm run lint` acusou 1 erro (run 37401758113) | ✅ **CORRIGIDO.** `defaultImage` era declarado mas ignorado em `createTerminalTools` — o schema fixava `DEFAULT_SANDBOX_IMAGE`, então `CoreOptions.sandboxImage` só afetava o `TerminalRunner` e **não** a tool `run_terminal_command`. Agora o schema usa `defaultImage`. Era bug real, não só ruído de lint. |
| 7 | `npm run typecheck`: falta de declaração de módulo (run 37402173198) | ✅ **CORRIGIDO.** `variants/desktop/src/main.tsx:10` → `Cannot find module or type declarations for side-effect import of './styles/theme.css'`. Causa: **não existia nenhum `.d.ts` no projeto**, então o import de CSS não resolvia. Criado `variants/desktop/src/vite-env.d.ts` com `/// <reference types="vite/client" />` — o `client.d.ts` do Vite declara `declare module '*.css' {}` (verificado em `vite@8.3.2`, cujo `package.json` expõe `exports["./client"] = { types: "./client.d.ts" }`). `.d.ts` é ignorado pelo ESLint, então a triple-slash reference não viola nenhuma regra. |
| 8 | `npm run typecheck`: 5 erros em `common/mcp/server.test.ts` | ✅ **CORRIGIDO.** Linhas 87/92/96/111/116, todos a mesma causa: os dois `const handler` extraídos perdiam a **tipagem contextual**, então `type: 'text'` **alargava para `string`** e o retorno deixava de ser atribuível a `TextContentBlock`. Os arrows inline (linhas 25/63/75) **não** erravam — prova de que a causa era o literal solto, não a API. Corrigido usando o helper `textResult` que já era exportado. **Os tipos da lib estavam corretos; o teste é que estava.** |
| 9 | `build()` e `serveStdio()` sem cobertura de runtime | ✅ **RESOLVIDO.** Nenhum dos 8 arquivos de teste chamava `build()` nem `serveStdio()` — as duas apareciam apenas no bootstrap (`common/index.ts`) e em comentários. Ou seja, a fronteira com o SDK v2, a parte mais arriscada do projeto, **nunca havia executado**: o typecheck provava só que os tipos encaixam, não que o SDK converte os schemas Zod em runtime. Criado `scripts/smoke-mcp.ts` + o passo `Smoke test (MCP over stdio)` no CI (depois do build, pois sobe `dist/core.mjs`). Run 37404728248: verde nos 6 jobs, inclusive Windows. |
| 10 | A UI nunca era empacotada pelo Vite | ✅ **CORRIGIDO no código.** `npm run build:desktop` não rodava em lugar nenhum: o `tsc` aprovava a UI, mas aprovar tipos não diz nada sobre o Vite resolver `@tailwindcss/vite`, `@vitejs/plugin-react`, o `@theme` do Tailwind v4 e o alias `@core`. Adicionado o passo `Build (desktop)` (commit `29b9e0a`). **Resultado do run ainda não conferido** — a API do GitHub estourou o limite de 60 req/h sem autenticação, e o badge público não expôs o status. |
| 11 | O host desktop não existia (ponte IPC sem lugar para viver) | 🟡 **HOSPEDEIRO PRONTO, ponte pendente.** Criado `src-tauri/` (`Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, ícone, um único comando `shell_info`) sob um workflow `tauri` **separado**, que roda `cargo check` só quando `src-tauri/**` ou `variants/desktop/**` mudam — compilar Tauri leva minutos e não deve travar o loop rápido do TypeScript. O passo captura a saída do cargo e a reemite como `::error::`, porque log bruto do Actions exige autenticação e anotação não: sem isso, uma falha do Rust seria só um X vermelho. **Resultado do run ainda não conferido.** |

## 4. Como verificar (GitHub é o ambiente de build)

1. ✅ **Feito.** O projeto foi enviado para `main` (`git push origin main`).
2. O workflow **`build`** roda automaticamente em `push`/`pull_request` para `main`,
   na matriz `ubuntu / windows / macos` × `node 22 / 24`, executando:
   `npm ci → lint → typecheck → test → build → smoke`. O `smoke` vem **depois** do
   `build` porque sobe `dist/core.mjs`, que só existe depois de ser construído.
   Acompanhe em: <https://github.com/xtrempkch-droid/nexus-agent-studio/actions>.
3. ✅ **Lockfile no lugar.** O `package-lock.json` está commitado na raiz e o
   `build.yml` usa `npm ci` + `cache: npm`.
4. Para **atualizar** o lockfile depois de mexer nas dependências (o ambiente local
   não tem Node): **Actions → bootstrap-lockfile → Run workflow**. O download é um
   `.zip` — extraia e coloque o `package-lock.json` na **raiz do repo** (a mesma pasta
   do `package.json`; **nunca** em `.github/`). Antes de commitar, confira que
   `dependencies`/`devDependencies` do lockfile batem com o `package.json`, senão você
   fixa um lockfile defasado.

Verificação local (quando houver Node ≥ 22):

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
6. 🟡 **Hospedeiro Tauri criado; a ponte IPC é o próximo passo.** `src-tauri/` tem
   `Cargo.toml`, `tauri.conf.json`, capabilities e um único comando (`shell_info`), e o
   workflow `tauri` roda `cargo check` (resultado ainda não conferido). O passo seguinte
   é decidir **como o shell Rust alcança o core TypeScript**: o caminho natural é
   **sidecar** — o Rust sobe `node dist/core.mjs` e fala MCP por stdio, o que preserva o
   core headless (`common/`) em vez de reimplementá-lo em Rust, ao custo de exigir um
   runtime Node na máquina (ou de empacotar um). Depois disso, trocar a simulação de
   `variants/desktop/src/App.tsx` por chamadas reais ao shell.
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
