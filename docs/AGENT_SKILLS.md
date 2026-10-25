# Skills e comandos do agente

Este projeto fala com agentes de IA por três camadas, e é importante não confundir
uma com a outra:

| Camada | Arquivo | Quando carrega |
| --- | --- | --- |
| **Sempre ligada** | `AGENTS.md`, `.github/copilot-instructions.md` | em toda sessão, sem pedir |
| **Por padrão de arquivo** | `.github/instructions/*.instructions.md` (`applyTo`) | ao criar/editar arquivo que casa com o glob |
| **Sob demanda** (`/comando`) | `.github/prompts/*.prompt.md` | quando a pessoa digita `/nome` |

Um prompt não substitui um invariante: se a regra vale **sempre**, ela pertence ao
`AGENTS.md` ou a um `*.instructions.md`. Prompt é para tarefa pontual.

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

## Instruções por arquivo

| Instrução | Cobre | `applyTo` |
| --- | --- | --- |
| [frontend-design](../.github/instructions/frontend-design.instructions.md) | tokens, hierarquia, foco, contraste, overflow, estado de espera | `variants/desktop/src/**` |
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

## Como adicionar um comando novo

1. `.github/prompts/<nome>.prompt.md`, com `description` começando por um verbo e
   `argument-hint` dizendo o que passar.
2. O corpo tem de citar **arquivo, comando e número reais** deste repositório. Prompt
   genérico o modelo já sabe de cor; o valor está no que só quem conhece o projeto sabe.
3. Se ele contradiz um invariante do `AGENTS.md`, está errado — ajuste o prompt.
4. Acrescente a linha na tabela acima e um item em `docs/PROJECT_STATE.md` §5.

## Manutenção

Os números citados aqui envelhecem (16 tools, 1.844 linhas em `App.tsx`, ~300 classes
cruas, 319 testes). Quando um deles mudar de verdade, atualize o prompt **na mesma
mudança** — número errado em prompt é a mesma classe de erro que doc errado: alguém
confia e não confere.
