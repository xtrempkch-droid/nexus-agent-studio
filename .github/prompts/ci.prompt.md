---
description: "Automação de CI/CD: abre PR com o template preenchido, acompanha os workflows e mergeia — pelo caminho que funciona nesta máquina"
name: "ci"
argument-hint: "o que o PR entrega (vazio = leia o diff e os commits da branch)"
agent: "agent"
---

## O que existe

Quatro workflows em `.github/workflows/`:

| Arquivo | Dispara em | Faz |
| --- | --- | --- |
| `build.yml` | push/PR em `main` | `lint → typecheck → test → build → smoke`, matriz 3 SO × Node 22/24 |
| `tauri.yml` | mudanças em `src-tauri/**`, `variants/desktop/**`, `common/**` | `cargo check` + `cargo test --include-ignored` |
| `desktop-binary.yml` | manual/tag | bundle do app para o dono testar |
| `bootstrap-lockfile.yml` | manual | regenera `package-lock.json` quando uma dep nova o invalidou |

O `build` é a fonte de verdade: se ele está verde na matriz, está verde — nenhum
"passou localmente" substitui Windows e macOS.

## O caminho real desta máquina (importante)

O **`gh` CLI não está instalado**. Então o fluxo que funciona é git sobre SSH:

```bash
git push -u origin <branch>
```

e o link de PR que o GitHub devolve no próprio push:

```
https://github.com/xtrempkch-droid/nexus-agent-studio/pull/new/<branch>
```

A tool MCP `create_pull_request` falha aqui com *"Callback URL is required"* — é
limitação do cliente, não motivo para pular o PR. Entregue o link com o corpo
pronto em vez de tentar de novo em loop.

**Se o `gh` existir** (confira com `command -v gh` antes de aconselhar), valide a
sintaxe antes de usar — `gh pr create --help`, `gh run watch --help` — e não invente
flags.

## Regras do repositório que o PR tem de respeitar

- **Corpo do PR usa `.github/pull_request_template.md` como está**: mesmos títulos,
  mesmo checklist, mesma ordem. Substitua o conteúdo, não a estrutura. Cada item do
  checklist marcado precisa de evidência; item que não se aplica fica desmarcado com
  uma linha dizendo por quê.
- **Comandos com resultado, não comandos soltos.** "Rodei `npm run test`" sem o
  número é insuficiente.
- **Commits em Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:`), com o trailer
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- **Rebase, não force-push** em branch compartilhada. Ao rebasear sobre `main`, os
  conflitos costumam ser nos docs (`PROJECT_STATE.md`, `AGENTS.md`, `roadmap.md`) —
  resolva à mão, preservando as duas histórias: a parágrafo de retomada do `main` e
  o item novo desta branch.
- **Antes de abrir o PR:** `docs/PROJECT_STATE.md` §2 e §5 atualizados, e a surface
  de tools conferida em três lugares se alguma tool mudou.

## Fechamento

Toda entrega termina com: branch pushada, link de PR, corpo salvo em
`~/.copilot/session-state/<id>/files/pr-<assunto>.md` (para colar sem perder nada),
e um parágrafo do que o CI ainda vai dizer que o local não disse.

Se o PR já existir, atualize o corpo em vez de abrir outro.
