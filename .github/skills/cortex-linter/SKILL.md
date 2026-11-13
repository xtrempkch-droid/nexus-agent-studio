---
name: cortex-linter
description: 'Faz o linter e os invariantes de estilo deste repositório serem obedecidos de fato: roda o lint, corrige as violações na origem e proíbe supressão nova. Use when: antes de concluir qualquer mudança de código, quando o CI falha no lint, ou quando o dono pede consistência de estilo.'
argument-hint: 'arquivo ou pasta (vazio = todo o repositório)'
---

# Cortex — conformidade de estilo, de verdade

"Estilo" aqui não é gosto: é o que o CI reprova, o que o `import type` protege
(fronteira headless do `common/`) e o que mantém o `stdout` do MCP legível. Corrigir
na origem, nunca silenciar.

## O que existe (e o que não existe)

- `eslint.config.js` com `typescript-eslint` recommended +
  `@typescript-eslint/consistent-type-imports` (**error**),
  `no-unused-vars` (**error**, `^_` liberado),
  `no-explicit-any` (**warn**), e `layout/**` fora do lint de propósito.
- **Não há Prettier.** Formatação é convenção + revisão: não introduza um formatador
  como efeito colateral de outra tarefa (política de dependências, `docs/architecture.md` §6).
- `npm run lint` = `eslint .`; o workflow `build` roda isso em 3 SOs.

## Procedimento

```bash
npm run lint 2>&1 | tail -40
```

Para cada violação, decida nesta ordem:

1. **Corrija o código.** 90% dos casos.
2. **Ajuste a configuração** — só se a regra está errada para o projeto, com uma
   frase no PR dizendo por quê. Mudar `eslint.config.js` para calar um aviso é o
   mesmo que apagar um teste.
3. **`eslint-disable-next-line` — último recurso**, e precisa de comentário na linha
   de cima dizendo **por que** a regra não se aplica ali. Existe **1** supressão no
   repositório hoje; mantenha esse número baixo. Supressão sem justificativa volta na
   revisão.

## Invariantes que o ESLint não vê (e o CI vê)

Estes são estilo no sentido que importa — rodam o risco de quebrar outra coisa:

```bash
grep -rn "console\.log" common/                                    # stdout é JSON-RPC do MCP
grep -rn "from '@core" variants/desktop/src | grep -v "import type" # core é só tipo na UI
grep -rn "window\.\|document\.\|localStorage" common/ --include=*.ts # common/ é headless
grep -rn "@modelcontextprotocol/sdk" . --include=*.ts              # v1 legado, proibido
grep -rn "\bany\b" common/ --include=*.ts | grep -v "test"        # aviso vira dívida
```

E a regra de comentário do repositório — a que mais aparece em revisão de IA: **só
comente o que o código não diz**. Um bloco narrando `// cria o servidor` acima de
`const server = new McpServer(...)` é ruído e volta. O padrão aceito é o de
`common/mcp/tools/atomicWrite.ts`: o **porquê** (o rename é o que torna atômico).

## Depois de corrigir

```bash
npm run lint && npm run typecheck && npm run test
```

Se você tocou só formatação/estilo, o teste tem de continuar passando **com a mesma
contagem** (hoje: 319 passed / 1 skipped). Contagem menor significa que algo foi
apagado junto.

## Relatório

| Arquivo:linha | Regra | Como foi corrigido | Supressão? |
| --- | --- | --- | --- |

Mais: contagem de supressões antes/depois, e qualquer regra cuja configuração você
propôs mudar (com a justificativa). Se sobrou violação, diga qual e por quê — lint
vermelho não se declara concluído.
