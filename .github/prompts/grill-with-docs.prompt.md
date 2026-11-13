---
description: "Cruza as decisões do código com a documentação do projeto (AGENTS.md, PROJECT_STATE, architecture) e aponta onde os docs mentem"
name: "grill-with-docs"
argument-hint: "arquivo de doc ou área (vazio = todos os docs de docs/ + AGENTS.md)"
agent: "agent"
---

Neste repositório a documentação **já mentiu** de formas caras: React 20 e Tailwind 5
(que não existem), `serveStdio(server)` em vez de factory, TypeScript 7.x, e a
afirmação de que a UI fala direto com o core. Por isso, aqui, toda afirmação absoluta
num doc é suspeita até ser conferida na fonte da verdade.

## Fontes da verdade (nesta ordem)

1. `package.json` / `package-lock.json` — versões.
2. O código — comportamento: `common/core.ts` (registro de tools), `src-tauri/src/*.rs`
   (comandos, `tool_timeout`, fila), `variants/desktop/src/**` (abas, settings).
3. `.github/workflows/*.yml` — o que o CI realmente roda.
4. Só então a prosa: `AGENTS.md`, `docs/PROJECT_STATE.md`, `docs/architecture.md`,
   `docs/roadmap.md`, `README.md`, `.github/copilot-instructions.md`.

## Procedimento

Extraia os números e nomes que envelhecem, e verifique **um a um**:

```bash
node -p "require('./package.json').dependencies"          # react, tailwind, zod, MCP
grep -c "registerTool" common/core.ts                     # 16 tools hoje
grep -rn "EXPECTED_TOOLS" -A 20 scripts/smoke-mcp.ts
grep -rn "MAX_MAX_STEPS\|DEFAULT_MAX_STEPS" common/agent/agentLoop.ts
grep -rn "fn tool_timeout" -A 20 src-tauri/src/mcp.rs
ls .github/workflows/                                     # 4 arquivos hoje
npm run test 2>&1 | tail -4                               # contagem real de testes
```

Depois, as afirmações de arquitetura, que são as que mais apodrecem:

- "a UI fala com o core" → hoje é `lib/shell.ts` (único ponto) + `lib/coreClient.ts`.
- "`variants/desktop` importa valores do core" → é `import type` só.
- "o mutex é segurado durante a chamada" → o `worker.rs` mudou isso.
- Node mínimo, matriz do CI, número de jobs.
- Tabela de §2 do `PROJECT_STATE.md`: cada linha ainda corresponde ao código?

## Saída

| Afirmação | Onde está | Realidade | Veredito |
| --- | --- | --- | --- |

`Veredito`: **contradiz** (corrigir agora) · **desatualizado** (número mudou) ·
**impreciso** (verdade parcial, engana) · **confere**.

Depois:

1. **Correções**, arquivo:linha e o texto novo sugerido — em commit `docs:`.
2. **Drift aceitável**, com o motivo (ex.: um doc descreve o design alvo, não o atual —
   desde que **diga** isso no próprio doc).
3. **Lacunas**: decisão importante tomada no código que não está em doc nenhum.

Regras: corrija o parágrafo errado, não reescreva o documento; nunca apague a
parágrafo de retomada do `PROJECT_STATE.md` (ele é a continuidade entre sessões); e
não "conserte" doc inventando versão de API — se não deu para confirmar, escreva
`VERIFICATION REQUIRED`.
