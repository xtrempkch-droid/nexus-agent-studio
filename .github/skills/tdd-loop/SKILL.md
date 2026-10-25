---
name: tdd-loop
description: 'Ciclo Red-Green-Refactor com Vitest: escreve o teste que falha, faz passar com a menor mudança e só então refatora. Use when: corrigir bug (com regressão) ou implementar comportamento novo em common/ ou variants/desktop/src/lib/.'
argument-hint: 'comportamento ou bug (vazio = o símbolo em foco)'
---

# TDD — vermelho, verde, refatorar

O valor não está em "ter teste": está em **ver o teste falhar pelo motivo certo**. Um
teste escrito depois do código que nunca foi visto vermelho testa o que o código faz,
não o que ele deveria fazer — e passa a proteger o bug.

## Onde o teste mora aqui

- Arquivo `*.test.ts` **ao lado** da fonte (`common/mcp/tools/fileTools.test.ts`).
- Vitest com `environment: node` — **não existe DOM**. Componente React não é
  testável por aqui; a lógica que vale testar de UI mora em
  `variants/desktop/src/lib/**` (é o que `preview.test.ts` faz, 22 testes) e o resto
  se verifica com `/playwright-browser`.
- Nada de `.only`, nada de `skip` novo sem motivo escrito no arquivo.

## Vermelho

1. Escreva o teste do **comportamento**, com o nome descrevendo a regra
   (`refuses a snippet that appears twice`), não o método.
2. Rode só ele e **leia a falha**:

```bash
npx vitest run common/mcp/tools/fileTools.test.ts -t "refuses a snippet"
```

3. Confirme que falhou **pela asserção** e não por erro de import. Um teste que falha
   com `Cannot find module` não é vermelho, é quebrado.
4. Cole a mensagem de falha no relatório — é a prova de que o teste tinha o que
   provar.

## Verde

5. A menor mudança que faz passar. Se você precisou mudar o teste para passar, o
   teste estava errado ou a regra era outra: **decida qual**, em voz alta, antes de
   editar a asserção.
6. Rode o arquivo, depois o conjunto: `npm run test`. A contagem tem de **subir** com
   o teste novo (hoje: 319 passed / 1 skipped → 320).

## Refatorar

7. Só com tudo verde. Um commit `refactor:` separado, sem mudar asserção.
8. `npm run lint && npm run typecheck && npm run test` antes de dizer que acabou.

## Casos onde o TDD de unidade não fecha

O projeto já aprendeu isso duas vezes, e nas duas o teste unitário passou enquanto o
produto quebrou:

- **Sandbox Docker** — os testes usavam executor falso; `argv[0]` não era o binário e
  **toda** chamada saía com 127. Regra: mudança de argv exige teste com processo
  **de verdade** (ou `npm run smoke`, que sobe o core real).
- **Commandos Tauri** — trabalho bloqueante em comando síncrono congela o WebKitGTK.
  Isso não se vê em teste de Node; vê-se abrindo a janela.

Nesses casos: unidade + **uma** verificação de processo real, e diga qual foi.

## Relatório

| Passo | O que rodou | Resultado |
| --- | --- | --- |
| vermelho | `npx vitest run … -t …` | falhou: `<mensagem>` |
| verde | `npm run test` | 320 passed |
| portão | `lint` + `typecheck` | ok |

Mais: o que o teste **não** cobre (e por isso foi para `/playwright-browser` ou para
o CI).
