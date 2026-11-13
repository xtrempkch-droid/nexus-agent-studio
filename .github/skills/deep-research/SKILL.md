---
name: deep-research
description: 'Investigação profunda e baseada em evidência antes de tocar no código: mapeia o fluxo real, formula hipóteses concorrentes e só então decide. Use when: arquitetura legada, refatoração de alto risco, bug que não reproduz, ou quando o dono pede "entenda antes de mexer".'
argument-hint: 'pergunta de investigação ou módulo (vazio = o módulo do diff atual)'
---

# Deep Research — entender antes de editar

A diferença entre isto e "ler o arquivo": aqui cada afirmação tem **evidência
citável** (`arquivo:linha`, saída de comando, teste) e cada hipótese tem o
**experimento que a distingue** da concorrente. Investigação sem hipótese concorrente
é narrativa.

## Fase 0 — a pergunta, em uma frase

Escreva a pergunta antes de abrir arquivo. Se não couber em uma frase, são duas
investigações e uma delas é a pergunta certa.

Exemplos que funcionaram neste repositório:
- "por que a janela congela durante uma chamada de tool?" → comando Tauri síncrono na
  main thread (`src-tauri/src/main.rs`), resolvido com `async` + `spawn_blocking`.
- "por que o sandbox sai com 127 em toda chamada?" → `argv[0]` não era o binário.

## Fase 1 — inventário com prova (não impressão)

```bash
git --no-pager log --oneline -20
find common -name '*.ts' | wc -l
grep -rn "registerTool" common/core.ts | wc -l     # surface atual: 16
cat docs/PROJECT_STATE.md | sed -n '/## 7/,/## 8/p'  # invariantes
```

Anote as **contagens** antes de ler o código: elas são o baseline que detecta
"isso mudou no meio da investigação".

## Fase 2 — mapa do fluxo real

Siga o caminho de um evento de ponta a ponta, escrevendo o mapa:

```
clique → App.tsx:linha → lib/shell.ts → invoke('call_core_tool') → main.rs → worker.rs → core → tool
```

Regra: **um mapa por afirmação de arquitetura**. Se você não consegue nomear a linha
onde a chamada atravessa a fronteira, o mapa está inventado — e é assim que doc de
arquitetura apodrece (já aconteceu aqui: `architecture.md` afirmava que a UI falava
direto com o core).

## Fase 3 — hipóteses concorrentes

| # | Hipótese | Predição se for verdadeira | O comando/teste que distingue |
| --- | --- | --- | --- |

Exija **≥ 2** hipóteses. Uma só é confirmação disfarçada. A coluna "predição" é o que
impede o clássico "parece que é X" seguido de correção que não muda nada.

Ferramentas de distinção disponíveis aqui, do mais barato ao mais caro:
`grep -n`, `git log -S'<trecho>'` (quando o comportamento nasceu), `npm run test -- <padrão>`,
`npm run smoke`, `cd src-tauri/harness && cargo test`, e execução real de um script
`tsx` para reproduzir com dado controlado.

## Fase 4 — risco da mudança

Para cada arquivo que a investigação indica alterar, responda em uma linha: **quem
mais depende disso?** (`grep -rn` do símbolo). Neste projeto, três respostas são
sempre críticas: superfície de tools (3 listas), framing do LSP (`Content-Length` em
bytes), e qualquer coisa que rode na main thread do Tauri.

## Fase 5 — a decisão (com critério de parada)

Pare quando: (a) uma hipótese sobreviveu a um teste que **derrubaria** as outras, e
(b) você sabe qual é o menor diff que resolve, e (c) sabe como provar que resolveu.

Entregue:

1. **Resposta** em 3 frases.
2. **Mapa do fluxo** com `arquivo:linha`.
3. **Tabela de hipóteses** com o resultado de cada experimento.
4. **O que continua desconhecido** — explícito, não maquiado de "fora de escopo".
5. **Próximo experimento** se a resposta não fechou.

Relatório longo só vai para arquivo (`docs/research/<slug>.md`) se o dono pedir; caso
contrário, inline. **Nesta skill você não edita código** — a investigação entrega a
decisão, e a implementação é outra tarefa (com `/tdd-loop` ou `/systematic-debugging`).
