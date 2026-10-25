# Skills e comandos do agente

Este projeto fala com agentes de IA por três camadas, e é importante não confundir
uma com a outra:

| Camada | Arquivo | Quando carrega |
| --- | --- | --- |
| **Sempre ligada** | `AGENTS.md`, `.github/copilot-instructions.md` | em toda sessão, sem pedir |
| **Por padrão de arquivo** | `.github/instructions/*.instructions.md` (`applyTo`) | ao criar/editar arquivo que casa com o glob |
| **Sob demanda** (`/comando`) | `.github/prompts/*.prompt.md` | quando a pessoa digita `/nome` |
| **Sob demanda, com assets** | `.github/skills/<nome>/SKILL.md` (+ `scripts/`) | quando a pessoa digita `/nome` ou o agente reconhece a tarefa |

Um prompt não substitui um invariante: se a regra vale **sempre**, ela pertence ao
`AGENTS.md` ou a um `*.instructions.md`. Prompt é para tarefa pontual.

**Sobre o caminho.** Skills deste repositório ficam em `.github/skills/`, que é o
caminho canônico do VS Code/Copilot. O ecossistema OpenCode lê
`.opencode/skills/<nome>/SKILL.md`, e o Claude Code lê `.claude/skills/<nome>/SKILL.md`
(este último também é lido pelo Copilot). Não duplique os arquivos: se você usar
OpenCode, aponte um dos caminhos para este diretório ou copie — cópia divergente é
pior que ausência, porque duas versões da mesma regra ensinam coisas diferentes.

## O que já existia antes desta coleção

Isto não foi inventado agora — só não tinha nome de comando:

| Capacidade | Onde já vivia |
| --- | --- |
| Portão de verificação | `AGENTS.md` ("Como verificar o seu trabalho") + workflow `build` |
| Revisão de código | checklist de `.github/pull_request_template.md` + disciplina do `AGENTS.md` |
| CI/CD | `.github/workflows/` (`build`, `tauri`, `desktop-binary`, `bootstrap-lockfile`) |
| Inspeção de ambiente | `scripts/env-probe.sh`, `docs/MACHINES.md` |
| Teste do core como processo real | `scripts/smoke-mcp.ts` |
| Documentação de contrato | o estilo de comentário já praticado (`writeFileAtomically`, `fetchPolicy`) |

O que os prompts abaixo acrescentam é **especificidade**: quais comandos, quais
arquivos, quais falhas já aconteceram aqui e o que elas ensinaram.

## Comandos disponíveis

| Comando | Arquivo | Para quê |
| --- | --- | --- |
| `/review` | [review.prompt.md](../.github/prompts/review.prompt.md) | revisar diff/PR atrás de bug real e violação de invariante |
| `/verify` | [verify.prompt.md](../.github/prompts/verify.prompt.md) | rodar o portão de 6 passos e relatar honestamente |
| `/run` | [run.prompt.md](../.github/prompts/run.prompt.md) | compilar, subir e **exercitar** o core e a UI antes de concluir |
| `/ci` | [ci.prompt.md](../.github/prompts/ci.prompt.md) | abrir PR com o template, acompanhar workflows, mergear |
| `/refactor` | [refactor.prompt.md](../.github/prompts/refactor.prompt.md) | SOLID/DRY e code smells sem mudar comportamento |
| `/doc-gen` | [doc-gen.prompt.md](../.github/prompts/doc-gen.prompt.md) | JSDoc de contrato nas APIs exportadas |
| `/grill-me` | [grill-me.prompt.md](../.github/prompts/grill-me.prompt.md) | interrogatório técnico sobre as decisões de design |
| `/grill-with-docs` | [grill-with-docs.prompt.md](../.github/prompts/grill-with-docs.prompt.md) | cruzar código × documentação e achar onde o doc mente |
| `/threat-model` | [threat-model.prompt.md](../.github/prompts/threat-model.prompt.md) | modelagem de ameaças no fluxo real de dados |
| `/caveman` | [caveman.prompt.md](../.github/prompts/caveman.prompt.md) | resposta ultra-compacta para sessões longas |
| `/explain-brief` | [explain-brief.prompt.md](../.github/prompts/explain-brief.prompt.md) | 3 tópicos sobre um arquivo ou o projeto |
| `/explain-error` | [explain-error.prompt.md](../.github/prompts/explain-error.prompt.md) | ler stack trace/log e apontar linha e causa |
| `/db-schema` | [db-schema.prompt.md](../.github/prompts/db-schema.prompt.md) | revisar contratos/schemas persistidos |
| `/script-gen` | [script-gen.prompt.md](../.github/prompts/script-gen.prompt.md) | script de automação portátil no estilo da casa |
| `/tailwind` | [tailwind.prompt.md](../.github/prompts/tailwind.prompt.md) | reduzir classes e unificar tokens no v4 |

## Skills (com assets)

| Skill | Arquivo | Para quê | Asset |
| --- | --- | --- | --- |
| `/skill-optimizer` | [SKILL.md](../.github/skills/skill-optimizer/SKILL.md) | achar trabalho manual repetido e escrever o artefato que o elimina | [`repeated-commands.sh`](../.github/skills/skill-optimizer/scripts/repeated-commands.sh) |
| `/agent-smith` | [SKILL.md](../.github/skills/agent-smith/SKILL.md) | dividir em subtarefas e delegar em paralelo, um worktree por subagente | — |
| `/deep-research` | [SKILL.md](../.github/skills/deep-research/SKILL.md) | investigar com evidência antes de tocar no código | — |
| `/cortex-linter` | [SKILL.md](../.github/skills/cortex-linter/SKILL.md) | lint e invariantes de estilo obedecidos, sem supressão nova | — |
| `/superpm` | [SKILL.md](../.github/skills/superpm/SKILL.md) | ciclo da tarefa no repositório (`PROJECT_STATE` §2/§5, roadmap) | — |
| `/playwright-browser` | [SKILL.md](../.github/skills/playwright-browser/SKILL.md) | abrir a UI de verdade: screenshot + DOM + console | [`ui-shot.sh`](../.github/skills/playwright-browser/scripts/ui-shot.sh) |
| `/tdd-loop` | [SKILL.md](../.github/skills/tdd-loop/SKILL.md) | vermelho → verde → refatorar com Vitest | — |
| `/systematic-debugging` | [SKILL.md](../.github/skills/systematic-debugging/SKILL.md) | repro → camada → hipótese → fix + regressão | — |
| `/ponytail` | [SKILL.md](../.github/skills/ponytail/SKILL.md) | barrar superengenharia e dependência desnecessária | — |
| `/feature-dev-pipeline` | [SKILL.md](../.github/skills/feature-dev-pipeline/SKILL.md) | 7 fases com portão para uma feature completa | — |
| `/to-spec` | [SKILL.md](../.github/skills/to-spec/SKILL.md) | pedido vago → spec aprovável em `docs/specs/` | — |

Os dois assets são **scripts reais, testados**: `repeated-commands.sh` roda sobre
`~/.bash_history` (581 linhas nesta máquina, filtra credenciais) e `ui-shot.sh` foi
executado contra o dev server nesta sessão — screenshot de 118 KB / 1600×1000 e DOM de
58 KB com as quatro abas do painel inferior presentes.

## Instruções por arquivo

| Instrução | Cobre | `applyTo` |
| --- | --- | --- |
| [frontend-design](../.github/instructions/frontend-design.instructions.md) | tokens, hierarquia, foco, contraste, overflow, estado de espera | `variants/desktop/src/**` |
| [react-best-practices](../.github/instructions/react-best-practices.instructions.md) | estado derivado, `key`, efeitos com limpeza, entrada, fronteira do IPC | `variants/desktop/src/**/*.tsx` |
| [web-performance](../.github/instructions/web-performance.instructions.md) | bundle, fontes remotas, listas sem teto, long task do core | `variants/desktop/**` |

## O que ficou de fora, e por quê

Honestidade vale mais que uma pasta cheia de prompt genérico:

- **`/db-schema`** — o projeto **não tem banco de dados**. O prompt existe, mas o alvo
  real dele são os contratos que o projeto de fato persiste ou valida: `inputSchema`
  das 16 tools, settings da UI, memória em `AGENTS.md`, envelope TS↔Rust.
- **`/ci`** — o `gh` CLI **não está instalado** na máquina do dono, e a tool MCP
  `create_pull_request` falha com *"Callback URL is required"*. O caminho que funciona é
  `git push` por SSH e o link `pull/new/<branch>` com o corpo pronto. O prompt documenta
  os dois caminhos em vez de fingir que o `gh` está lá.
- **Vercel Web Design Guidelines** — viram `web-performance.instructions.md` já
  adaptadas: não há Next.js nem deploy em CDN, então `next/image`, ISR e afins não
  descrevem este runtime.
- **`/doc-gen`** — existe contra a própria regra de estilo do repositório ("comente só o
  que precisa de esclarecimento"), então ele documenta **contrato** (o que é garantido,
  o que é recusado, efeito colateral), nunca narração de linha.

### Recusados na segunda leva (2026-10-25), com motivo

- **`/rc` (Remote Control, Claude Code)** — é recurso do produto hospedado da Anthropic
  (relay + interface web), não um arquivo que se copie para um repositório. E o
  princípio conflita com este projeto: expor uma sessão de terminal por URL pública é o
  oposto do modelo local-first, onde nem `web_fetch` sai da máquina sem
  `NEXUS_WEB_ACCESS=1`.
- **`/voice` (push-to-talk)** — ditado é recurso do editor/SO (ou extensão do VS Code),
  não conteúdo versionado. Nada a adicionar.
- **Skills for Microsoft Fabric / Azure** — o projeto não tem Azure, Fabric, Spark nem
  pipeline de dados. Skill sem alvo é peso morto que ainda ocupa contexto.
- **"Permissões por subagente em SQLite" (Agent Smith original)** — não há SQLite neste
  projeto. As fronteiras reais são o `DockerSandbox` (o que executa), o
  `resolveWorkspacePath` (o que alcança) e a fila FIFO do `worker.rs` (uma chamada ao
  core por vez). A isolação por subagente é o **git worktree**, e é isso que
  `/agent-smith` usa.
- **Vercel/Anthropic design, de novo** — já existiam (`frontend-design` +
  `web-performance`). O que faltava era o **padrão de React** (estado derivado, `key`,
  efeitos, fronteira do IPC), que virou `react-best-practices.instructions.md`. RSC,
  streaming SSR e `next/image` continuam fora: não existem neste runtime.

## Auditoria: o que foi pedido × o que existia

Duas listas foram pedidas. O resultado, item por item — **presente** significa que o
comando/documento já existia e foi apontado, não recriado:

| Pedido | Situação | Onde |
| --- | --- | --- |
| `/review` | já existia sem nome de comando | `review.prompt.md` + checklist do PR |
| `/verify` (Claude Code) | já existia como comando do `package.json` | `verify.prompt.md` |
| `/run` (Claude Code) | **novo** | `run.prompt.md` |
| `/grill-me`, `/grill-with-docs`, `/caveman` | já existiam (leva anterior) | `*.prompt.md` |
| CI/CD, `/doc-gen`, `/refactor`, `/threat-model`, `/explain-brief`, `/explain-error`, `/script-gen`, `/tailwind`, `/db-schema` | já existiam (leva anterior) | `*.prompt.md` |
| Frontend Design (Anthropic) | **presente** | `frontend-design.instructions.md` |
| Web Design Guidelines (Vercel) | **presente** (adaptada) | `web-performance.instructions.md` |
| Vercel React Best Practices | **novo** — só a parte de React faltava | `react-best-practices.instructions.md` |
| Skill Optimizer | **novo** | `skills/skill-optimizer` |
| Agent Smith / multi-agente | **novo** (adaptado: worktree, não SQLite) | `skills/agent-smith` |
| Deep-Research Skills | **novo** | `skills/deep-research` |
| Cortex AI Skills / Linter Enforcer | **novo** | `skills/cortex-linter` |
| SuperPM Skills | **novo** | `skills/superpm` |
| TDD Loop (Cursor) | **novo** | `skills/tdd-loop` |
| Systematic Debugging (Cursor) | **novo** | `skills/systematic-debugging` |
| Ponytail (Cursor) | **novo** | `skills/ponytail` |
| Playwright Browser Automation | **novo** — com alternativa sem dependência | `skills/playwright-browser` |
| To-Spec / Write a PRD | **novo** | `skills/to-spec` |
| Feature-Dev Pipeline | **novo** | `skills/feature-dev-pipeline` |
| `/rc`, `/voice` | **recusados** — recurso de produto, não arquivo | ver acima |
| Fabric / Azure | **recusados** — sem alvo no projeto | ver acima |

## Como adicionar um comando novo

1. Escolha o tipo: tarefa pontual → `.github/prompts/<nome>.prompt.md`; fluxo
   multi-passo com script/template → `.github/skills/<nome>/SKILL.md` (a pasta e o
   campo `name` têm de ser idênticos); regra que vale sempre → `AGENTS.md` ou
   `*.instructions.md`.
2. `description` começa por um verbo e diz **quando** usar; `argument-hint` diz o que
   passar. Descrição é a superfície de descoberta: sem as palavras que a pessoa usaria,
   o arquivo nunca é encontrado.
3. O corpo tem de citar **arquivo, comando e número reais** deste repositório. Prompt
   genérico o modelo já sabe de cor; o valor está no que só quem conhece o projeto sabe.
4. Se ele contradiz um invariante do `AGENTS.md`, está errado — ajuste o arquivo.
5. **Valide o frontmatter com um parser** (YAML malformado falha em silêncio) e, se
   houver script, **execute-o** incluindo o caminho de erro.
6. Acrescente a linha na tabela acima e um item em `docs/PROJECT_STATE.md` §5.

## Manutenção

Os números citados aqui envelhecem (16 tools, 1.844 linhas em `App.tsx`, ~300 classes
cruas, 319 testes, 11 skills). Quando um deles mudar de verdade, atualize o arquivo que
o cita **na mesma mudança** — número errado em prompt é a mesma classe de erro que doc
errado: alguém confia e não confere.

Os dois scripts das skills são código: rode-os depois de mexer.
`repeated-commands.sh` aceita um arquivo de histórico como 2º argumento (teste com um
arquivo temporário, não com o seu). `ui-shot.sh` depende de um Chromium já instalado e
de um servidor respondendo — os dois caminhos de erro (sem navegador, sem servidor)
devem sair com mensagem clara e código ≠ 0.
