---
description: "Cria ou revisa script de shell/Node para automação local, no estilo e nas restrições das duas máquinas deste projeto"
name: "script-gen"
argument-hint: "o que o script deve fazer (vazio = proponha o utilitário que falta)"
agent: "agent"
---

## O estilo que já existe aqui

Leia os dois antes de escrever:

- `scripts/env-probe.sh` — **POSIX `sh` de propósito**, sem bash/Node/Python: roda numa
  máquina que pode não ter nada, que é exatamente o caso que ele existe para detectar.
- `scripts/smoke-mcp.ts` — TypeScript rodado por `tsx`, que sobe o `dist/core.mjs` de
  verdade e o dirige com cliente MCP real. Asserção sobre processo real, não dublê.

Escolha a linguagem pelo alvo: precisa rodar antes de qualquer toolchain → `sh`
POSIX. Precisa falar MCP, JSON ou processo → TypeScript com `tsx` (já é devDependency;
não adicione outra).

## Regras não negociáveis

- `set -eu` no mínimo; melhor `set -euo pipefail` — mas **só em bash/zsh**, `pipefail`
  não existe em `sh` POSIX (o `env-probe.sh` é `sh` e não usa).
- **Nada de flag GNU-only** (`stat -c`, `date -d`, `sed -i` sem sufixo, `readlink -f`):
  o CI inclui macOS e o BSD não aceita. `#!/usr/bin/env` e caminhos citados sempre.
- **Nunca** `pkill`/`killall` por nome: mate o PID que você criou, e limpe em `trap`.
- Script que escreve arquivo: escreva em temporário e `mv` (o mesmo motivo do
  `writeFileAtomically` do core).
- Script que automatiza git: nada de `--force`, nada de `reset --hard`, nada de push.
- Segredo nunca vai para argumento (aparece em `ps`) nem para arquivo versionado:
  variável de ambiente ou stdin.
- Saída legível por humano **e** por script: mensagem no `stderr`, dado no `stdout`,
  `exit 1` no erro. O `env-probe.sh` faz assim.
- Comente o **porquê** em uma linha; nada de cabeçalho narrando cada linha.

## Antes de entregar

```bash
sh -n scripts/<nome>.sh          # sintaxe, sem bash-ismo
shellcheck scripts/<nome>.sh     # se estiver instalado
bash -n scripts/<nome>.sh
```

E **rode**: script não executado é script quebrado. Mostre a saída real, inclusive do
caso de erro (rode com uma entrada inválida de propósito).

## Se o pedido for vago

Proponha **um** utilitário que o projeto de fato não tem, em uma frase, e pergunte
antes de escrever o segundo. Candidatos reais, se a pessoa quiser escolher:

- `scripts/verify.sh` — o portão de seis comandos em um só, com falha rápida.
- `scripts/fresh-clone.sh` — `npm ci` + portão, o teste que o workflow faz.
- `scripts/check-docs.sh` — números que envelhecem (16 tools, contagem de testes).
