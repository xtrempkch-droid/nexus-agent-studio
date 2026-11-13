---
name: feature-dev-pipeline
description: 'Pipeline de 7 fases para uma funcionalidade nova de ponta a ponta, com portão de saída em cada fase. Use when: a entrega é uma feature completa (core + UI + docs), não um ajuste pontual.'
argument-hint: 'a funcionalidade (vazio = ler o próximo item da docs/roadmap.md)'
---

# Feature Dev Pipeline

Sete fases com **portão**: não se avança sem o artefato da anterior. O modo de falha
que isto evita é o clássico "implementei, agora vou ver se era isso que ele queria" —
que custa a feature inteira, não um retrabalho.

## 1. Especificar (portão: critérios executáveis)

Use `/to-spec` → `docs/specs/NNN-<slug>.md`. Obrigatório:

- **Fora de escopo** explícito (é o que impede o crescimento silencioso).
- **Critério de aceite executável**: comando → resultado esperado. "Funciona" não é
  critério; `npm run smoke` imprimindo `all assertions passed` é.
- As decisões em aberto viram pergunta ao dono (`ask_user`), não suposição.

## 2. Investigar (portão: mapa com `arquivo:linha`)

`/deep-research` no caminho que a feature atravessa:

```
webview → lib/shell.ts → main.rs → worker.rs → common/core.ts → tool
```

Se a feature precisa de **tool nova**, o mapa já registra as **três** listas que
precisam mudar (`core.test.ts`, `scripts/smoke-mcp.ts`, `src-tauri/src/mcp.rs`) e a
surface atual (16 tools).

## 3. Implementar (portão: menor diff que cumpre o critério)

Ordem que costuma funcionar: **contrato → teste → implementação → ligação na UI**.

- Core primeiro, porque a UI depende de tipos (`import type` — o `common/` é headless).
- Ferramenta que sai da máquina (rede, processo) mantém o opt-in explícito
  (`NEXUS_WEB_ACCESS`, `NEXUS_UNSANDBOXED`), nunca decidido pelo webview.
- `stdout` do core é JSON-RPC: log é `console.error`.

## 4. Testar local (portão: 6 comandos)

```bash
npm run lint && npm run typecheck && npm run test && npm run build && npm run smoke && npm run build:desktop
```

Mais o que a feature exige: `/playwright-browser` se mexeu em UI; `cargo test` no
`src-tauri/harness` se mexeu em Rust sem Tauri. **`lint`/`test` vermelho não avança.**

## 5. Revisar (portão: nenhum achado crítico aberto)

`/review` no próprio diff, e `/ponytail` se ele cresceu. Achado de segurança →
`/threat-model`. Corrigir antes de seguir; "depois eu vejo" é o item que fica.

## 6. Entregar (portão: PR com evidência)

`/ci`: branch pushada, corpo no template do repositório, cada comando com o resultado
real, e a seção "não verificado" preenchida. Commits em Conventional Commits com o
trailer `Co-authored-by`.

## 7. Validar (portão: estado atualizado)

`/superpm` para fechar: §5 com o item numerado, §2 atualizado, roadmap, parágrafo de
retomada, e o próximo candidato escolhido por critério.

**A fase 7 não é opcional.** Uma feature entregue e não registrada precisa ser
redescoberta pela próxima sessão — e o custo disso é maior que o da feature.

## Quando NÃO usar

- Ajuste de uma linha, correção de typo, mudança de texto: `/verify` e pronto.
- Bug com causa conhecida: `/tdd-loop` (menos fases, mesma disciplina).
- Investigação sem compromisso de entrega: `/deep-research` sozinho.

## Relatório final

Uma tabela fase → portão → evidência (comando/saída). Se alguma fase foi pulada,
escreva qual e por quê — pipeline sem registro é teatro.
