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
| 1 | Infra, CI/CD, governança | ✅ completo | ⏳ não executado |
| 2 | Core TypeScript (`common/`) | ✅ completo | ⏳ não executado |
| 3 | Sandbox Docker + IPC | ✅ completo | ⏳ não executado |
| 4 | Arquitetura de plugins | ✅ completo | ⏳ não executado |
| 5 | Configuração e build | ✅ completo | ⏳ não executado |

**Resumo honesto: o pipeline está VERDE.** A máquina onde o código foi produzido
**não tem `node` nem `npm`** e não há `sudo` sem senha, então nada roda localmente —
o **GitHub Actions é o ambiente de build** (§4). No run **37402844523** (commit
`51e61a3`) os **6 jobs** (ubuntu / windows / macos × node 22 / 24) passaram com
**todos os passos verdes**:

- ✅ `npm install` — passa.
- ✅ `npm run lint` — passa.
- ✅ `npm run typecheck` — passa (depois de corrigir os 6 erros do run 37402173198; §3, linhas 7–8).
- ✅ `npm run test` — **passa**. Primeira execução real do Vitest.
- ✅ `npm run build` — **passa**. Primeira execução real do esbuild; gerou `dist/core.mjs`.

A coluna **"Verificado em runtime"** da tabela acima continua ⏳ de propósito: o
código passa no CI, mas o servidor MCP ainda não foi conectado a um cliente real,
nem a UI a um backend (falta a ponte IPC). Compilar não é o mesmo que funcionar.

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

## 4. Como verificar (GitHub é o ambiente de build)

1. ✅ **Feito.** O projeto foi enviado para `main` (`git push origin main`).
2. O workflow **`build`** roda automaticamente em `push`/`pull_request` para `main`,
   na matriz `ubuntu / windows / macos` × `node 22 / 24`, executando:
   `npm ci → lint → typecheck → test → build`.
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
npm run dev:desktop     # UI em http://localhost:5173
node dist/core.mjs      # core como MCP server stdio
```

## 5. Próximos passos (ordem sugerida)

1. ✅ **Pipeline verde no run 37402844523** — os 6 jobs (ubuntu / windows / macos ×
   node 22 / 24) passaram em `lint`, `typecheck`, `test` e `build`. Não há erro
   pendente no CI.
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
5. Construir a ponte IPC (`variants/desktop` ↔ `common/`) — hoje a UI roda uma
   simulação determinística marcada em `variants/desktop/src/App.tsx`.
6. Avaliar se o Monaco volta a ser usado (foi trocado por `<textarea>` para não
   adicionar dependência não verificada).
7. ✅ **Aviso de depreciação resolvido.** `actions/checkout@v4`,
   `actions/setup-node@v4` e `actions/upload-artifact@v4` miravam o Node 20, deprecado
   nos runners. Todos foram para `@v5`, **depois de confirmar as tags** com
   `git ls-remote` (`checkout` 5.1.0, `setup-node` 5.0.0, `upload-artifact` 5.0.0).
8. *(Opcional)* `common/mcp/types.ts` exporta um `AnyToolHandler` que **colide de nome**
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
