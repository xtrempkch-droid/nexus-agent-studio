---
name: agent-smith
description: 'Divide uma tarefa grande em subtarefas independentes e as delega a subagentes em paralelo, cada um num git worktree próprio e com escopo de arquivos declarado. Use when: a mudança toca módulos que não se cruzam, ou o dono pede multi-agente/paralelismo.'
argument-hint: 'a tarefa grande (vazio = o próximo item da docs/roadmap.md)'
---

# Agent Smith — dividir e delegar

O ganho do paralelismo aqui é **contexto isolado**, não velocidade de digitação: cada
subagente queima o próprio contexto lendo um módulo, e devolve um relatório curto. O
custo é **conflito de merge** e revisão fragmentada. Se o custo não paga o ganho, o
modo certo é serial.

## Pré-requisito honesto

Delegar exige ferramenta de subagente e worktree. Confira antes de prometer:

```bash
git --version                       # worktree vem do git 2.5+
ls -d .github/skills                # o repositório aceita artefatos de agente
```

- **Com ferramenta de subagente** (no VS Code: `task` com tipos `explore`, `task`,
  `general-purpose`, `code-review`, `security-review`), delegue por escopo.
- **Sem ela:** faça serialmente e **diga** que não houve paralelismo. Não simule
  subagente escrevendo "um agente faria X".

> O "Agent Smith" original atribui permissões por subagente em SQLite. **Aqui não há
> SQLite nem banco.** As fronteiras reais são: o `DockerSandbox` (o que o comando
> executa), o `resolveWorkspacePath` (o que o arquivo alcança) e a fila FIFO do
> `worker.rs` (uma chamada ao core por vez). A isolação por subagente é o
> **worktree** — é isso que o plano usa.

## Passo 1 — decidir se vale dividir

Divida só com **≥ 3 subtarefas** e **arquivos disjuntos**. Teste rápido:

```bash
git --no-pager diff --stat origin/main...HEAD   # ou a lista de arquivos do plano
```

Se dois itens do plano tocam o mesmo arquivo, eles **são um item** — worktrees
paralelas sobre o mesmo arquivo produzem três versões do mesmo trecho e uma revisão
que não converge.

## Passo 2 — plano de partição (antes de delegar)

| # | Subtarefa | Arquivos que **só** ela escreve | Tipo de subagente | Entrega esperada |
| --- | --- | --- | --- | --- |

Regras de partição:

- **Possua arquivos, não tópicos.** "Cuide da UI" não serve; `PreviewPanel.tsx` +
  `preview.ts` serve.
- **Um escrito, N leitores.** Vários subagentes podem *ler* `common/core.ts`; só um
  pode *escrever* (é a superfície asserida em 3 lugares — `core.test.ts`,
  `scripts/smoke-mcp.ts`, `src-tauri/src/mcp.rs`).
- **Contrato antes de paralelizar.** Se a subtarefa B depende do tipo que A ainda vai
  criar, escreva o contrato (assinatura + teste) primeiro, na branch principal.

## Passo 3 — worktrees

```bash
git worktree add ../nexus-wt-a -b feat/parte-a origin/main
git worktree add ../nexus-wt-b -b feat/parte-b origin/main
git worktree list
```

Cada subagente recebe: caminho do worktree, arquivos que pode escrever, o comando de
verificação que **tem de** passar (`npm run lint && npm run typecheck && npm run test`
dentro daquele worktree — o `node_modules` pode ser reutilizado por link simbólico,
mas se não estiver, rode `npm ci` ali) e o formato de resposta: arquivos, teste,
linhas, e o que ficou fora.

## Passo 4 — integrar, um por vez

```bash
git checkout feat/principal
git merge --no-ff feat/parte-a && npm run test
git merge --no-ff feat/parte-b && npm run test
```

**Teste entre cada merge.** Um merge que quebra isolado é diagnosticável; três merges
juntos não são. Rode o portão completo uma vez no fim, na branch principal.

## Passo 5 — limpar (parte do trabalho)

```bash
git worktree remove ../nexus-wt-a
git worktree prune
```

Worktree esquecido vira confusão de qual branch está ativa — e o `git status` passa a
mentir sobre onde você está.

## Quando NÃO usar

- Menos de 3 arquivos, ou arquivos que se cruzam.
- Tarefa que exige uma decisão de arquitetura: uma cabeça decide, o resto executa.
- Investigação de um único fluxo contínuo (a resposta está em encadear leituras, e a
  fragmentação perde o fio).
