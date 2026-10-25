---
name: systematic-debugging
description: 'Depuração por evidência em vez de tentativa: reproduz, localiza a camada, testa hipóteses com um comando cada e corrige com teste de regressão. Use when: bug não óbvio, falha intermitente, ou quando a primeira correção não resolveu.'
argument-hint: 'o sintoma exato (cole o erro). Vazio = leia a última falha relatada'
---

# Systematic debugging

Regra que governa tudo: **nada muda até existir uma reprodução.** Correção sem
reprodução é chute com sintaxe de código, e o segundo chute custa o dobro porque agora
o primeiro também precisa ser desfeito.

`/explain-error` diagnostica e para. Esta skill faz o ciclo inteiro.

## 0. Reproduzir, com o dado mínimo

| Sintoma | Como reproduzir aqui |
| --- | --- |
| falha de tool / resposta estranha do core | `npm run smoke` (sobe `dist/core.mjs` e dirige MCP real) |
| lógica de `common/` | `npx vitest run <arquivo> -t "<nome>"` |
| Rust sem Tauri | `cd src-tauri/harness && cargo test` |
| UI | `sh .github/skills/playwright-browser/scripts/ui-shot.sh http://localhost:5173/ …` |
| app empacotado | abrir a janela; é a **única** forma de ver main-thread e WebKitGTK |

Se não reproduz: isso **é** o diagnóstico até prova em contrário — falha intermitente
é concorrência, fila, ou dependência de tempo. Registre a taxa observada antes de
mexer.

## 1. Localizar a camada

Cinco camadas, e a pergunta certa é "qual delas pode produzir este sintoma?":

```
webview (React)  →  IPC (Tauri/Rust)  →  core (MCP/TS)  →  tool  →  mundo externo
```

Sinal rápido: erro **com** stack de TS → core/tool. Erro **sem** stack, ou app que
para de responder → Rust/main thread. Resposta vazia/estranha mas sem erro → contrato
entre camadas (envelope, nome de campo, schema).

## 2. Uma hipótese por vez, com predição

| Hipótese | Predição verificável | Comando | Resultado |
| --- | --- | --- | --- |

Duas hipóteses concorrentes no mínimo. O comando tem de **poder derrubar** a hipótese;
se ele passa nos dois mundos, não serve.

## 3. Bisseção quando não há hipótese

```bash
git log --oneline -15
git bisect start && git bisect bad HEAD && git bisect good <tag>
git log -S'<trecho que sumiu>' --oneline    # quando o comportamento nasceu/morreu
```

O `git log -S` já encontrou regressões reais neste tipo de projeto; ele responde "quem
mudou isso" em um comando.

## 4. Corrigir a causa, provar com teste

- Fix mínimo, na causa identificada.
- **Teste de regressão que falha antes e passa depois** (`/tdd-loop`). Sem isso, o
  mesmo bug volta na próxima refatoração.
- Se o bug era de contrato entre camadas, o teste tem de atravessar a fronteira (ex.:
  `scripts/smoke-mcp.ts`, não um mock).

## 5. Fechar

```bash
npm run lint && npm run typecheck && npm run test && npm run build && npm run smoke
```

Remova a instrumentação temporária (`console.error` de depuração, `sleep`, `--verbose`
no CI). Log esquecido no core vai para `stderr` e polui a sessão de quem usar o app.

## Relatório

```
reprodução: <comando> → <saída>
camada:     <qual> em <arquivo:linha>
causa:      <uma frase>
correção:   <o diff mínimo>
regressão:  <teste que falha antes / passa depois>
```

Mais: o que você descartou (e como), e o risco de a causa raiz ser maior que o fix —
se for, diga e proponha o item de roadmap em vez de remendar.
