---
description: "Refatora aplicando SOLID/DRY e removendo code smells sem mudar comportamento — dentro das restrições deste código"
name: "refactor"
argument-hint: "arquivo, módulo ou cheiro específico (ex: 'App.tsx', 'os três registros de tool')"
agent: "agent"
---

O contrato de um refactor aqui: **o comportamento é idêntico e a suíte prova isso.**
Se o diff muda o que o usuário vê, o que a tool responde ou o que o arquivo contém,
não é refactor — é feat/fix e vai em outro commit.

## Antes de tocar em nada

```bash
npm run test 2>&1 | tail -6      # anote a contagem: 319 passed hoje
npm run lint && npm run typecheck
```

Guarde o número. Depois do refactor a contagem tem de ser **maior ou igual**; cair
significa que um teste foi apagado junto com o código que ele protegia.

## Restrições que mudam o que é "mais limpo" aqui

- `common/` é **headless**: extrair um helper que usa DOM para o core é proibido, e o
  caminho inverso (helper de React para `common/`) também não existe.
- O registro de tools é **type-erased** (`AnyToolHandler`) de propósito: as APIs
  públicas continuam genéricas para os handlers inferirem argumentos de
  `inputSchema`. "Tipar melhor" removendo o genérico quebra a inferência de todos.
- Imports relativos levam extensão explícita (`.ts`/`.tsx`); `baseUrl` é proibido.
- **Renomear ou remover uma tool não é refactor**: a surface (16 tools) é contrato
  asserido em três lugares e visível para o modelo. Renomear = breaking change.
- **Renomear token de cor em massa não entra num refactor de feature.** Hoje há ~300
  utilidades `slate-*`/`indigo-*` cruas contra 9 usos dos tokens `ide-*` de
  `styles/theme.css`: é uma tarefa real, mas é *uma* tarefa, com commit próprio.
- React 19 + Tailwind v4 CSS-first: não existe `tailwind.config.js`, e adicionar
  dependência de UI contraria a política de dependências (`docs/architecture.md` §6).

## Cheiros que valem a pena neste código

| Cheiro | Onde aparece | Refactor que paga |
| --- | --- | --- |
| `App.tsx` com **1.844 linhas** e muitos estados | abas, settings, editor, agente | extrair componentes por aba, com props explícitas |
| `unwrap` de envelope repetido | `lib/coreClient.ts` e chamadas de tool | um helper único, sem mudar o tipo de retorno |
| `try/catch` repetido com a mesma mensagem | tools do core | um wrapper que preserva a mensagem original |
| Listas paralelas (nomes/tipos/handlers) | registro de tools, ícones | um array de objetos derivado |
| Constantes duplicadas entre camadas | orçamento do agente (4 números espelhados) | comentário cruzado **não** é refactor: a duplicação é intencional, documente |

## Processo

1. Nomeie o cheiro em **uma frase**, com arquivo:linha.
2. Faça a menor mudança que o remove. Nada de "já que estou aqui".
3. Rode o portão: `npm run lint && npm run typecheck && npm run test`.
4. Um commit por cheiro, prefixo `refactor:`, corpo dizendo o que **não** mudou.
5. Se o refactor expôs um bug, **pare**: corrija em commit `fix:` separado, com teste
   que falha antes e passa depois.

## Relatório

Tabela: cheiro → antes (linhas/arquivos) → depois → o que garante que o comportamento
não mudou (teste/asserção específica). Se algo ficou de fora e por quê, diga.
