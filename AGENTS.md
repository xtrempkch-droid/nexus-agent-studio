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
| `typescript` | `^7.0.2` | `baseUrl` é proibido (deprecado) |
| `vite` / `vitest` / `eslint` | `^8.3.2` / `^5.0.3` / `^10.12.0` | |
| Node.js | `>=22` | CI: 22 (LTS), 24 (Active LTS) |

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

## Como verificar o seu trabalho

Este projeto **compila no GitHub** — a máquina de desenvolvimento original não
tinha Node/npm, então o CI é a fonte de verdade.

```bash
npm install
npm run lint && npm run typecheck && npm run test && npm run build
```

Ou, sem Node local: faça push de um branch e deixe o workflow `build` rodar
(lint → typecheck → test → build na matriz de 3 SOs × 2 versões de Node).

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
