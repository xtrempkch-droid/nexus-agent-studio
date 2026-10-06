# Copilot instructions

Este repositório tem instruções canônicas em **[`AGENTS.md`](../AGENTS.md)** e um
arquivo de rastro em **[`docs/PROJECT_STATE.md`](../docs/PROJECT_STATE.md)**.
Leia os dois antes de propor mudanças.

## Não negociáveis

1. **Nunca invente APIs.** Verifique a assinatura na documentação oficial da
   versão declarada no `package.json`. Se não conseguir confirmar, escreva
   `VERIFICATION REQUIRED: <api>` em vez de fabricar.
2. **`@modelcontextprotocol/sdk` é o v1 legado — não use.** O v2 são os pacotes
   `@modelcontextprotocol/server` e `@modelcontextprotocol/client`.
3. `serveStdio(() => server)` recebe uma **factory**, nunca uma instância.
4. `stdout` é o canal JSON-RPC do MCP: use `console.error` para log.
5. `common/` é headless: **sem DOM, sem React**. `variants/desktop` importa do
   core **apenas tipos** (`import type`).
6. Imports relativos levam extensão explícita (`.ts`/`.tsx`); não use `baseUrl`
   (deprecado no TS 7).
7. Verificação obrigatória antes de concluir:
   `npm run lint && npm run typecheck && npm run test && npm run build`
   (ou deixe o workflow `build` rodar no GitHub). Se não puder rodar, diga isso.

## Versões verificadas (2026-10-05)

React `^19.3.0` (não existe React 20) · Tailwind `^4.3.3` (não existe Tailwind 5,
o `@theme` CSS-first é do v4) · Zod `^4.6.5` via `zod/v4` · TypeScript `~6.0.2`
(**não** 7.x: `typescript-eslint@8` exige `<6.1.0`, senão o `npm install` falha com
ERESOLVE e o CI nem chega ao typecheck) · `@modelcontextprotocol/server` `^2.3.1` ·
Node `>=22`.

Ao terminar uma tarefa, atualize `docs/PROJECT_STATE.md` (§2 e §5) para manter a
continuidade entre sessões.
