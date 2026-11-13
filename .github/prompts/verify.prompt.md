---
description: "Roda o portão de verificação deste repositório e relata cada resultado de verdade — inclusive o que não rodou"
name: "verify"
argument-hint: "caminho ou suíte para focar (vazio = portão completo)"
agent: "agent"
---

O portão deste projeto tem seis passos e uma regra: **não se declara concluído com
qualquer um vermelho**. Rode na ordem, reportando o resultado real de cada um. Se o
usuário pediu escopo (um arquivo, uma suíte), rode só o mínimo que cobre a mudança e
**diga** que o resto não foi rodado.

```bash
npm run lint          # eslint .
npm run typecheck     # tsc --noEmit
npm run test          # vitest run
npm run build         # tsc --noEmit + esbuild do core
npm run smoke         # dist/core.mjs + cliente MCP real (surface de tools)
npm run build:desktop # Vite + Tailwind v4 + alias @core
```

Rust, quando `src-tauri/**` mudou:

```bash
cd src-tauri/harness && cargo test    # bridge.rs/mcp.rs/worker.rs, ~2,5 s
```

O `cargo check` do `main.rs` **completo** exige GTK/WebKitGTK e só roda no workflow
`tauri`. Não tente fingir que rodou: escreva que ficou para o CI.

## Como ler uma falha (não "consertar" afrouxando)

- **Teste vermelho:** leia a asserção antes de mexer no código. Este repositório já
  teve dois bugs achados pelos próprios testes (`truncated` comparado com o texto já
  cortado, regex de link falhando em `[x](javascript:alert(1))`). A asserção estava
  certa nos dois casos.
- **`core.test.ts` / `smoke` / e2e do `mcp.rs`:** se a contagem de tools falhou, a
  causa é quase sempre **uma tool adicionada em um ou dois dos três lugares** — não
  um teste desatualizado. Corrija os três.
- **`typecheck`:** `TS2307` em import relativo costuma ser extensão `.ts` faltando;
  `TS6059`/`baseUrl` é configuração que não se introduz.
- **Vermelho só no Windows/macOS:** separador `/` fixo, `file:///ws` literal. Compare
  contra `pathToFileURL`/`join`, não contra uma string. Localmente passa; o CI pega.
- **`npm install` com ERESOLVE:** alguém subiu o TypeScript para 7.x.
- **Falha que parece intermitente:** rode duas vezes antes de chamar de flaky — e se
  for flaky de verdade, é bug, não motivo para `retry`.

## Relatório

Uma tabela com **uma linha por comando**, incluindo o que não rodou:

| Comando | Resultado | Observação |
| --- | --- | --- |
| `npm run test` | ✅ 319 passed, 1 skipped | 29 arquivos |

Depois: contagem de testes antes e depois (se o número caiu, alguém apagou teste),
e o que falta para o CI confirmar (matriz 3 SO × 2 Node, workflow `tauri`).

Nunca escreva "tudo verde" a partir de uma leitura parcial da saída, e nunca
conclua a tarefa com um passo vermelho em aberto.
