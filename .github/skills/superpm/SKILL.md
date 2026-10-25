---
name: superpm
description: 'Mantém o ciclo de vida da tarefa dentro do repositório: escolhe o próximo item, atualiza docs/PROJECT_STATE.md (§2 e §5) e o roadmap, e planeja a próxima fatia a partir do que ficou aberto. Use when: fechar uma entrega, decidir "o que agora?", ou o dono pedir organização/planejamento.'
argument-hint: 'entrega que está sendo fechada, ou "próximo" para planejar (vazio = ler o estado atual)'
---

# SuperPM — o projeto como estado, não como memória

Este repositório já tem o mecanismo; ele só precisa ser usado com disciplina:
`docs/PROJECT_STATE.md` é o arquivo de rastro (§2 status por fase, §3 bloqueios, §5
próximos passos com itens numerados, §7 invariantes), `docs/roadmap.md` é a lista
"Next", e o parágrafo **"Ao retomar"** é o que uma sessão futura lê primeiro.

**A regra que dá sentido a tudo:** documentação de estado não é registro histórico —
é a única coisa que sobrevive à sessão. Se não está lá, não aconteceu.

## A. Antes de começar (escolher, não improvisar)

```bash
sed -n '/## 5\./,/## 6\./p' docs/PROJECT_STATE.md | head -60   # §5
sed -n '/## Next/,$p' docs/roadmap.md                          # fila
grep -n "🔴\|bloquead" docs/PROJECT_STATE.md | head
```

Escolha por esta ordem, e **diga** qual critério usou:

1. **Bloqueio** (§3) que impede o dono de usar o app.
2. **Regressão** relatada por quem usa a janela (foi assim que os itens 29 e 33
   apareceram — nenhum era visível no browser stubado).
3. Item da fila que **fecha um invariante** ou remove dívida de segurança.
4. Item que o dono pediu explicitamente.

## B. Durante

Uma tarefa = uma branch = commits em Conventional Commits. Se a tarefa revelou outra,
ela vira **item numerado** na §5 na hora — não confie na memória de "depois eu anoto".

## C. Ao fechar (o checklist que não é opcional)

- [ ] `docs/PROJECT_STATE.md` §5: item **numerado novo** com o que foi feito, a
      **decisão** estranha e por quê, **Verificado** (comandos + números reais) e
      **não verificado** (honesto).
- [ ] §2: a linha da fase afetada reflete a realidade (inclusive o que continua
      "🟡 parcial").
- [ ] `docs/roadmap.md`: `[x]` no item, e as pendências que a tarefa **criou** viram
      sub-itens `[ ]`.
- [ ] Parágrafo "Ao retomar": o que uma sessão futura precisa saber em 30 segundos.
- [ ] Se a superfície de tools mudou: as **três** listas (`core.test.ts`,
      `scripts/smoke-mcp.ts`, `src-tauri/src/mcp.rs`) e as skills/prompts que citam o
      número.
- [ ] `AGENTS.md` se algum invariante novo nasceu.

**Nunca**: reescrever o parágrafo de retomada apagando a sessão anterior (acrescente,
não substitua a história), nem marcar ✅ com verificação que não rodou.

## D. Planejar a próxima fatia

Entregue no máximo **3** candidatos, cada um com: objetivo em uma frase, arquivos que
toca, risco, e **como se prova** que terminou. Ordenados pelo critério do passo A.

| # | Candidato | Arquivos | Risco | Prova de conclusão |
| --- | --- | --- | --- | --- |

Candidatos que já estão abertos e são bons exemplos de "por que este item existe":

- **Escape por symlink no `pathGuard.ts`** — reproduzido: `ws/link.txt ->
  /tmp/secret.txt` é aceito e lido. Fix: `realpath` do alvo (e do pai ao criar) +
  revalidação de contenção; teste POSIX-only (criar symlink no Windows exige
  privilégio).
- **`get_execution_log`** — o `ExecutionLogger` já grava `delta: {before, after}` e
  tem `getEntries()`, mas nenhuma tool lê: a aba "Inspeção de Alterações" mostra nome
  de tool em vez de diff.
- **Fontes remotas num app offline** — `variants/desktop/index.html` carrega Inter e
  Fira Code de `fonts.googleapis.com`.

## Relatório

Três blocos: **o que mudou no estado** (arquivo → o que foi escrito), **próximo
candidato com a justificativa do critério**, e **o que ficou desatualizado de
propósito** (e por quê). Planejamento sem estado atualizado é opinião.
