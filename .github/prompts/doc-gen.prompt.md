---
description: "Gera JSDoc/docstrings nas APIs exportadas, no padrão deste repositório — que comenta o porquê, não o que a linha já diz"
name: "doc-gen"
argument-hint: "arquivo ou símbolo. Vazio = APIs exportadas de common/ que ainda não têm doc"
agent: "agent"
---

Existe uma tensão que você precisa resolver antes de escrever a primeira linha: a
regra de estilo deste repositório é **comentar só o que precisa de esclarecimento**,
e um gerador de documentação tende a produzir exatamente o contrário — narração do
que o código já diz. O que se gera aqui é **contrato**, não narração:

- o que a função **garante** e o que ela **recusa** (o caso que lança/retorna erro);
- unidade e faixa dos parâmetros quando não são óbvios;
- efeito colateral (escreve arquivo? spawna processo? manda bytes para fora da máquina?);
- por que a decisão estranha foi tomada, quando o código não conta.

Fora do escopo: `@param` repetindo o nome do parâmetro, `@returns` de função óbvia,
cabeçalho de arquivo listando imports.

## Alvos que valem

- `common/**` exportado — é a API pública do core: `common/core.ts` (opções e
  registro), `common/mcp/types.ts` (`ToolContext`, contratos), `common/web/fetchPolicy.ts`
  (o que a política **não** cobre), `common/mcp/tools/*.ts`.
- Rust público de `src-tauri/src/mcp.rs` / `worker.rs` — principalmente o contrato de
  `tool_timeout` (`None` = padrão, `Some(0)` = sem prazo) e o contrato de `CoreWorker`
  (fila FIFO, nada preso durante a chamada, requisição que gasta o orçamento na fila é
  recusada sem ser enviada).
- Não documente componentes React linha a linha; documente props cujo nome não baste.

## Regras de honestidade

- Se você não sabe por que um parâmetro existe, **não invente**: leia os testes e os
  chamadores; se continuar obscuro, escreva `// Revisar: propósito de <x> não está
  claro no código` e liste no relatório. Doc inventada é pior que doc ausente.
- Não prometa o que o código não faz. Se a política de SSRF não protege contra DNS
  rebinding, o JSDoc diz isso — como o módulo já faz.
- Não traduza nomes de API. Prosa em português, identificadores em inglês.

## Formato de exemplo (o padrão da casa)

```ts
/**
 * Grava o arquivo inteiro via temporário + rename.
 *
 * O rename é o que torna a gravação atômica: um leitor concorrente vê o conteúdo
 * antigo ou o novo, nunca metade. Um `writeFile` direto deixa o arquivo truncado
 * se o processo morrer no meio.
 */
export async function writeFileAtomically(...)
```

## Verificação

```bash
npm run lint && npm run typecheck && npm run test
```

Doc não muda comportamento, então o teste **tem de continuar passando com a mesma
contagem**. Se `typecheck` reclamar de `@param` inexistente, o JSDoc está errado, não
o código. Ao terminar: diff só de comentários — se apareceu mudança de lógica, ela
sai deste commit.

Relatório: tabela símbolo → onde → o que foi documentado → o que ficou como
"Revisar" e por quê.
