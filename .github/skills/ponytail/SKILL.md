---
name: ponytail
description: 'Guarda contra superengenharia: barra abstração especulativa, dependência nova e generalização sem segundo caso de uso. Use when: revisar um diff que "já pensa no futuro", antes de aceitar um refactor grande, ou quando o código cresce mais que o problema.'
argument-hint: 'diff, arquivo ou proposta (vazio = o diff atual contra origin/main)'
---

# Ponytail — o problema é menor que a solução

O sintoma é reconhecível: o diff resolve um caso e traz uma interface, uma opção de
configuração, um registro genérico e um teste do teste. Isso não é robustez — é
superfície que ninguém pediu e que a próxima sessão vai ter que manter.

## O teste de três perguntas

Para cada peça nova, responda:

1. **Existe segundo uso hoje?** (não "vai existir")
2. **Alguém chamaria isso por outro nome?** Se sim, o nome está errado.
3. **Se eu apagar, o que quebra?** Se nada, apague.

## Cheiros concretos, com o comando

| Cheiro | Como achar | Veredito |
| --- | --- | --- |
| Interface/classe com **uma** implementação | `grep -rn "implements \|extends " common/ --include=*.ts` | remover a indireção — mas **não** no registro de tools: `AnyToolHandler` é type-erased **de propósito** (as APIs públicas seguem genéricas para o handler inferir args de `inputSchema`) |
| Opção de config com **um** valor possível | `grep -rn "options\?\.\|Options {" common/` | constante local até aparecer o segundo valor |
| Dependência nova para algo de 20 linhas | `git --no-pager diff origin/main...HEAD -- package.json` | stdlib primeiro; `docs/architecture.md` §6 |
| `utils.ts`/`helpers.ts` sem dono | `ls common/**/utils*` | o helper mora ao lado de quem usa |
| Camada de abstração para "trocar depois" | diff que introduz `Provider`, `Adapter`, `Factory` | YAGNI até haver dois provedores reais |
| Teste que testa o mock | assertivas sobre dublês em vez de comportamento | testar o contrato |
| Tratamento de erro para caso impossível | `try` que só reescreve a mensagem | deixar o erro subir |

## O que **não** é superengenharia aqui (não corte)

- **Três listas de tools** (`core.test.ts`, `scripts/smoke-mcp.ts`,
  `src-tauri/src/mcp.rs`): redundância de **asserção**, e já pegou divergência real.
- **`writeFileAtomically`** (temp + rename): 15 linhas que impedem arquivo truncado.
- **Quatro números do orçamento do agente espelhados entre camadas**: duplicação
  inevitável (a UI não importa valores do Rust); o comentário cruzado é o contrato.
- **`writeFileAtomically` chamado por todo escritor**: um único caminho de escrita é
  menos código, não mais.
- **Sanitização de caminho** em cada tool de arquivo: é a fronteira de segurança.

A diferença entre os dois grupos: o primeiro conjunto **reduz risco de falha
silenciosa**; o segundo **prevê um futuro que ninguém pediu**.

## Como responder

Não reescreva o diff: aponte e proponha o menor corte.

| Peça | Por que sobra | Corte proposto | Linhas |
| --- | --- | --- | --- |

Se o autor **tem** o segundo caso de uso, aceite e não discuta. A skill existe contra
especulação, não contra complexidade justificada — e complexidade justificada vem com
o caso concreto escrito no PR.
