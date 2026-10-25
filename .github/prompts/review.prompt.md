---
description: "Revisa um diff ou PR atrás de bugs reais, regressões e violações dos invariantes deste repositório (não estilo — o lint já cobre)"
name: "review"
argument-hint: "branch, número de PR ou caminho. Vazio = diff da branch atual contra origin/main"
agent: "agent"
---

Revise **o que mudou**, não o repositório. Se o usuário passou um argumento (branch,
PR, caminho), é esse o escopo; senão:

```bash
git fetch origin main --quiet
git --no-pager diff --stat origin/main...HEAD
git --no-pager diff origin/main...HEAD
git status --short          # arquivo não commitado não aparece no diff acima
```

`AGENTS.md` e o checklist de `.github/pull_request_template.md` são o padrão já
acordado — a revisão confere se o diff **cumpre** aquele padrão, não o repete.

## O que só quem conhece este repositório vê

Rode estes seis, porque são erros que o lint **não** pega e o CI pega de um jeito
confuso:

```bash
grep -rn "window\.\|document\.\|localStorage" common/ --include=*.ts     # common/ é headless
grep -rn "from '@core" variants/desktop/src | grep -v "import type"      # só tipos
grep -rn "console\.log" common/                                          # stdout é JSON-RPC
grep -rn 'file:///\|"/tmp/\|C:\\' common/ scripts/ --include=*.ts        # teste não portátil
grep -rn "path\.join(.*'/'\|\.split('/')" common/ --include=*.ts
find common -name '*.test.ts' | wc -l                                    # mudança pública tem teste?
```

Depois, no diff especificamente:

- **Tool nova/renomeada?** A surface é asserida em **três** lugares e o CI fica
  vermelho se um faltar: `common/core.test.ts` (lista ordenada),
  `scripts/smoke-mcp.ts` (`EXPECTED_TOOLS` + contagem) e o e2e
  `handshakes_with_the_real_core` em `src-tauri/src/mcp.rs`. A surface atual são
  **16 tools**.
- **Comando Tauri síncrono fazendo trabalho bloqueante?** Tem de ser `async fn` com
  `tauri::async_runtime::spawn_blocking`. É o que deixava o WebKitGTK congelado.
- **Mudou argv de sandbox?** `argv[0]` tem de ser o binário (`'docker'`). Um argv
  começando em `run` vira `spawn('run')` → `ENOENT` → `exitCode: 127` em toda
  chamada. E teste com executor falso não prova isso: exige processo de verdade.
- **API externa nova?** Confira a assinatura na doc da versão do `package.json`. Se
  não deu para confirmar, o correto é `VERIFICATION REQUIRED: <api>` no código —
  não uma assinatura plausível.
- **`@modelcontextprotocol/sdk`** em qualquer import é bloqueante: é o v1 legado.
- **Comentário** só onde o código não diz o porquê; um diff que narra o que a linha
  já diz é ruído e volta.

## Formato do relatório

Uma tabela, só com o que você **viu** no diff:

| Severidade | Arquivo:linha | O problema | Por que quebra | Confiança |
| --- | --- | --- | --- | --- |

- `Severidade`: 🔴 crítico (quebra em produção/perda de dados) · 🟠 alto · 🟡 médio · ⚪ baixo.
- `Por que quebra`: o cenário concreto (entrada, sequência), não "pode causar problemas".
- `Confiança`: n/10. Abaixo de 6, diga o que faltou ler.

Depois, três linhas: **o que você conferiu e está certo** (para não revisar de novo),
**o que não deu para verificar**, e os comandos que você rodou.

**Não conserte nada.** Revisão entrega achados; a correção é outra tarefa e outro
commit. Sem elogio, sem resumo do PR.
