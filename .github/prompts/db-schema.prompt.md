---
description: "Revisa esquemas e contratos persistidos (settings, memória, inputSchema das tools) — e, se aparecer SQL/Prisma no projeto, indexação e queries lentas"
name: "db-schema"
argument-hint: "arquivo de esquema, migração ou 'os contratos das tools' (vazio = todos os contratos persistidos)"
agent: "agent"
---

## Premissa honesta

**Este projeto não tem banco de dados.** Não há SQL, migração, ORM nem Prisma em
lugar nenhum do repositório — se você grepar por `CREATE TABLE`, `migration` ou
`schema.prisma`, o resultado é vazio. Não invente um esquema para ter o que revisar.

O que existe e merece a mesma análise (campo escrito, campo lido, campo morto):

| Contrato | Onde | Ponto de risco |
| --- | --- | --- |
| `inputSchema` de cada tool (16) | `common/mcp/tools/*.ts` | é a **fronteira validada pelo SDK** antes do handler: campo opcional demais faz o handler receber `undefined` |
| Settings da UI (persistidos) | `variants/desktop/src/App.tsx` | campo novo sem valor padrão deixa o app sem estado válido |
| Memória do projeto | `AGENTS.md` §`## Memória do projeto` | append-only, teto de 200 fatos, 500 caracteres por fato |
| Envelope core ↔ shell | `lib/coreClient.ts`, `src-tauri/src/mcp.rs` | nomes de campo repetidos em TS e Rust; renomear de um lado só quebra em silêncio |
| Mensagens LSP | `common/lsp/` | shapes de `publishDiagnostics` → `InlineHint` |
| Tipos de aba / budget | `type BottomTab`, `timeoutSeconds` | enum espelhado em Rust e TS |

## O que revisar em cada um

- **Todo campo tem escritor e leitor?** Campo só escrito é lixo que o tempo não apaga;
  campo só lido é bug esperando.
- **Opcional vs obrigatório reflete a realidade?** Um `?` onde o produtor sempre
  envia esconde o erro do consumidor.
- **Enums espelhados** entre TS e Rust (`BottomTab`, nomes de tool, `maxSteps`): a
  divergência não dá erro de compilação, dá comportamento estranho.
- **Limites** (teto de fatos, 200 linhas de console, 2 MB de corpo): o limite existe,
  mas existe **mensagem** quando ele corta? Corte silencioso parece bug de dados.
- **Renomear é breaking change** atravessando a fronteira — vale o mesmo tratamento da
  surface de tools.

## Se um banco aparecer depois

Então sim: índices para as colunas usadas em filtro/join, N+1 dentro de laço, transação
em torno de escrita multi-tabela, e nunca remover coluna na mesma release que parou de
escrevê-la. Mas só quando existir — não antes.

## Entrega

| Contrato | Campo | Escrito em | Lido em | Risco |
| --- | --- | --- | --- | --- |

Mais: as três divergências que causariam bug silencioso, e o teste que cada uma pede
(vitest em `common/**`, e para a UI `variants/desktop/src/lib/**` — a suíte roda em
`environment: node`, sem DOM).
