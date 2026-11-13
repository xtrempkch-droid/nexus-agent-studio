---
name: skill-optimizer
description: 'Observa o histórico de comandos e as sessões deste repositório, encontra o trabalho manual que se repete e escreve o SKILL.md (ou o script) que o elimina. Use when: a mesma sequência de comandos já apareceu várias vezes, o dono diz "de novo isso", ou pede para o projeto aprender um fluxo.'
argument-hint: 'fluxo repetido ou período (vazio = ~/.bash_history + checkpoints das sessões)'
---

# Skill Optimizer

Skill metalinguística: ela não resolve a tarefa — ela **produz a automação** que
resolve a tarefa da próxima vez. O produto é um arquivo, e o critério de sucesso é
que ninguém digite aquela sequência de novo.

## Evidência antes de opinião

Automação inventada é dívida: um `SKILL.md` que ninguém usa ocupa contexto e some do
índice em duas sessões. Colete prova de repetição primeiro:

```bash
# 1. comandos digitados à mão (o sinal mais barato e mais honesto)
sh .github/skills/skill-optimizer/scripts/repeated-commands.sh 3

# 2. trabalho que já foi feito em sessões anteriores
ls ~/.copilot/session-state/*/checkpoints/*.md 2>/dev/null | tail -20

# 3. verificações que o dono repete dentro do repo
git log --oneline -40 --format='%s'
```

O script conta comandos e mostra os prefixos que aparecem **3 vezes ou mais**
(threshold no argumento). Ele não lê segredo nenhum: descarta linhas com
`KEY`/`TOKEN`/`PASSWORD`/`SECRET` antes de imprimir.

## Decisão: qual artefato

| Padrão observado | Artefato certo | Onde |
| --- | --- | --- |
| Sequência de comandos com ordem fixa e decisões | **skill** com procedimento | `.github/skills/<nome>/SKILL.md` |
| Uma tarefa curta com parâmetro (um alvo por vez) | **prompt** | `.github/prompts/<nome>.prompt.md` |
| Comando determinístico, sem julgamento | **script** | `scripts/*.sh` ou o `scripts/` da própria skill |
| Regra que vale **sempre**, em todo arquivo | **instrução** (ou `AGENTS.md`) | `.github/instructions/*.instructions.md` |
| Nada — foi um episódio, não um fluxo | **não crie arquivo** | — |

Regra de corte: **menos de 3 ocorrências não é fluxo.** Um caso único vira skill só
quando o dono pede explicitamente.

## Procedimento

1. **Nomeie o fluxo em uma frase**, com os comandos reais que o compõem.
2. **Escreva o passo a passo na ordem em que você o executaria**, com o comando exato
   — não "rode os testes", e sim `npm run test`.
3. **Cite três números reais** do projeto (contagem de teste, número de tools,
   `arquivo:linha`). É o que separa este arquivo de um prompt genérico, e o que
   denuncia quando ele envelhece.
4. **Escreva a seção "quando NÃO usar"** — o modo de falha de toda skill é ser
   carregada fora do contexto em que faz sentido.
5. Crie o `SKILL.md` (`name` **igual ao nome da pasta**, minúsculo com hífens) e, se
   houver script, `scripts/` ao lado. Referencie com `./scripts/...`.
6. **Rode o script** e cole a saída real no relatório. Script não executado é script
   quebrado.
7. Indexe em `docs/AGENT_SKILLS.md` (tabela) e registre em `docs/PROJECT_STATE.md` §5
   — a continuidade é o produto.
8. Valide o frontmatter com um parser (falha de YAML é **silenciosa**):

```bash
python3 - <<'PY'
import yaml, re, glob
for p in sorted(glob.glob('.github/skills/*/SKILL.md')):
    fm = re.match(r'^---\n(.*?)\n---\n', open(p, encoding='utf-8').read(), re.S)
    d = yaml.safe_load(fm.group(1))
    folder = p.split('/')[2]
    assert d['name'] == folder, f'{p}: name != pasta'
    assert len(d['description']) <= 1024, f'{p}: description longa demais'
    print('ok', p)
PY
```

## Quando NÃO usar

- Uma única execução de algo caro (um `cargo build`, uma sonda de rede).
- Fluxo cujo julgamento varia toda vez — vira documentação, não skill.
- Repetir o que `AGENTS.md` já manda: skill que duplica invariante ensina o agente a
  ignorar os dois.

## Manutenção (parte do trabalho)

Toda skill que cita número se torna mentira quando o número muda. Ao fechar uma
tarefa que mudou contagem de teste, surface de tools ou tamanho de arquivo, atualize
as skills que citam aquele número **na mesma tarefa** — é o passo 3 cobrando a
própria dívida.
