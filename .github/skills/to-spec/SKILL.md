---
name: to-spec
description: 'Transforma um pedido vago em especificação técnica curta, com escopo, fora de escopo, critérios de aceite executáveis e riscos, salva em docs/specs/. Use when: o pedido é ambíguo ou grande, ou precisa de aprovação antes de existir código.'
argument-hint: 'o pedido em uma frase (vazio = proponha a partir da §5 do PROJECT_STATE)'
---

# To-Spec — pedido vago → documento decidível

O produto é um arquivo que uma pessoa consegue **aprovar ou recusar** sem ler código.
Se o documento não permite dizer "não é isso", ele não é uma spec — é um resumo do
que você pretende fazer.

## Antes de escrever: as 3 perguntas que mudam tudo

Não invente resposta; pergunte (uma rodada só, com `ask_user`):

1. **Quem usa e em que momento?** (o dono testando o app ≠ um usuário final)
2. **O que fica de fora?** — a pergunta que mais economiza trabalho.
3. **O que já existe e serve?** Liste os 16 tools, as abas, os comandos `/…`; metade
   dos pedidos é uma variação de algo que já está no repositório.

## Template — `docs/specs/NNN-<slug>.md`

```markdown
# <título imperativo>

## Problema
<2–3 frases: o que dói hoje, com evidência (arquivo:linha, mensagem do dono, issue)>

## Escopo
- <o que será feito, em termos observáveis pelo usuário>

## Fora de escopo
- <o que NÃO será feito — inclusive o que é tentador fazer "de brinde">

## Critérios de aceite (executáveis)
| # | Critério | Como se verifica | Esperado |
| --- | --- | --- | --- |
| 1 | <comportamento> | `npm run smoke` | `all assertions passed` |

## Contratos afetados
- Tools: <nomes> — atualiza as 3 listas (`core.test.ts`, `scripts/smoke-mcp.ts`,
  `src-tauri/src/mcp.rs`)?
- Envelope TS↔Rust, `inputSchema`, settings da UI, `AGENTS.md`?

## Segurança e privacidade
<o que sai da máquina? o que executa? o que escreve em disco? opt-in explícito?>

## Riscos
| Risco | Probabilidade | Impacto | Mitigação |
| --- | --- | --- | --- |

## Não decidido
- <a pergunta que ainda precisa de resposta humana>
```

## Critério de aceite honesto

Comparação direta:

| Ruim | Bom |
| --- | --- |
| "o timeout deve ser configurável" | "com `timeoutSeconds: 0` a espera não tem prazo; o campo mostra 'sem limite de tempo'" |
| "melhorar a UI de configurações" | "a janela de configurações rola com `max-h-[70vh] overflow-y-auto`, e Salvar continua visível com 30 modelos listados" |
| "tratar erros" | "tool com `isError: true` aparece na aba Agente com a mensagem do core, não 'Error: undefined'" |

Se você não consegue escrever a coluna "como se verifica", o critério não está
definido — e implementar antes disso é o que produz a feature que ninguém pediu.

## Depois da aprovação

1. Número sequencial (`docs/specs/001-…`), nunca sobrescrever uma spec aprovada —
   mudança de rumo vira `002` com referência à anterior.
2. A spec **entra no commit** junto com a implementação, na primeira entrega.
3. Se a implementação divergir, atualize a spec no mesmo PR e diga por quê.
4. Opcional: corpo de issue/PR. O `gh` **não está instalado** aqui, então isso é texto
   para colar — não tente `gh issue create`.
