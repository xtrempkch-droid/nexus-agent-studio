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

**Resumo honesto:** todo o código está escrito e passou por **validação estática**
(TS server: sem erros de sintaxe/estrutura). **Nenhum** `lint`, `typecheck`,
`test` ou `build` foi executado, porque a máquina onde o código foi produzido
**não tem `node` nem `npm`** e não há `sudo` sem senha.

## 3. Bloqueio atual e como resolvê-lo

| # | Bloqueio | Resolução |
| --- | --- | --- |
| 1 | Sem Node/npm na máquina local | **Use o GitHub como ambiente de build** — os runners têm Node. Veja §4. |
| 2 | `package-lock.json` ausente → `npm ci` e `cache: npm` falhariam no CI | Já mitigado: o `build.yml` cai para `npm install` e não pede cache. Gere o lockfile com o workflow `bootstrap-lockfile` e **volte a usar `npm ci` + `cache: npm`**. |
| 3 | `git push` requer credenciais (sem `gh` CLI, sem credential helper) | `gh auth login` **ou** `git push origin main` digitando as credenciais no terminal. Nunca coloque tokens em chat. |
| 4 | A UI desktop é uma **simulação** no browser | Falta a ponte IPC (Electron/Tauri) entre `variants/desktop` e `common/`. Ver §5. |

## 4. Como verificar (GitHub é o ambiente de build)

1. Faça o push do commit local (`git status` mostra `ahead 1`).
2. O workflow **`build`** roda automaticamente em `push`/`pull_request` para `main`,
   na matriz `ubuntu / windows / macos` × `node 22 / 24`, executando:
   `lint → typecheck → test → build`.
3. Para gerar o lockfile sem Node local: **Actions → bootstrap-lockfile → Run workflow**.
   Baixe o artefato `package-lock` e commite como `package-lock.json`.
4. Depois disso, no `build.yml`: troque o passo de install por `npm ci` e
   reative `cache: npm`.

Verificação local (quando houver Node ≥ 22):

```bash
npm install
npm run lint && npm run typecheck && npm run test && npm run build
npm run dev:desktop     # UI em http://localhost:5173
node dist/core.mjs      # core como MCP server stdio
```

## 5. Próximos passos (ordem sugerida)

1. Rodar o CI e **corrigir o que ele apontar** (é a primeira execução real do
   TypeScript contra os tipos do SDK).
2. **Ponto de maior incerteza:** em `common/mcp/server.ts`, o `build()` passa
   `inputSchema: tool.definition.inputSchema` (tipado como `z.ZodType`) para
   `McpServer.registerTool`, com a opção de config montada separadamente e o
   handler convertido via `as never`. Se o `typecheck` reclamar, ajuste à
   assinatura real do SDK — **não invente** a assinatura, confira a doc.
3. Gerar o `package-lock.json` e endurecer o CI de volta (`npm ci` + cache).
4. Construir a ponte IPC (`variants/desktop` ↔ `common/`) — hoje a UI roda uma
   simulação determinística marcada em `variants/desktop/src/App.tsx`.
5. Avaliar se o Monaco volta a ser usado (foi trocado por `<textarea>` para não
   adicionar dependência não verificada).

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
| Vitest `^4.x` | `latest` = **5.0.3** (`V4` = 4.1.11) | Usado `^5.0.3` |
| Node matrix 22/24/**26** | Node 26 não confirmado | Matriz só com **22 / 24** |

Confirmado como **correto** no prompt: pacotes `@modelcontextprotocol/server` e
`/client` v2 (2.3.1), `@modelcontextprotocol/sdk` é o v1 legado (não usar),
`import * as z from 'zod/v4'`, `registerTool(name, {description, inputSchema}, handler)`,
TypeScript 7.0.2, `@typescript/typescript6` 6.0.2, esbuild 0.28.2, ESLint 10.x.

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
