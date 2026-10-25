---
description: "Performance e boas práticas web no WebView do app: bundle, fontes, imagens, long tasks e estabilidade de layout"
applyTo: "variants/desktop/**"
---

# Performance no WebView (adaptado — não é Next.js)

## O que **não** se aplica

Este app é um WebView (WebKitGTK no Linux, WKWebView no macOS, WebView2 no Windows),
empacotado pelo Tauri e servido de dentro do binário. **Não** há Next.js, não há deploy
na Vercel, não há servidor, ISR, edge runtime nem `next/image`. Regras de Core Web
Vitals de site público (TTFB, CDN, cache HTTP de asset) não descrevem este runtime: o
"servidor" é o disco local. Aplicar receita de Next aqui é ruído.

## O que se aplica, e como se mede

| Métrica de verdade aqui | Como observar |
| --- | --- |
| **Primeiro paint do shell** | abrir o app; o alvo é a UI aparecer antes de qualquer chamada ao core |
| **Latência de input sob carga** | a *long task* real é a **sessão serializada do core** (`worker.rs`): com `ask_agent` em voo, todo o resto espera na fila |
| **Estabilidade de layout** | o texto do agente chegando em streaming e os diagnósticos do LSP aparecendo no editor não podem empurrar o conteúdo |
| **Tamanho do bundle** | `npm run build:desktop` — o número que se registra no PR quando a mudança é de UI |

Medir antes de otimizar: sem um número antes/depois, "otimizei" é opinião.

## Regras que evitam as regressões que já aconteceram

- **Nunca uma chamada de core por evento.** Cada tecla/scroll vira requisição que fica
  na fila do worker e a espera acumula. Debounce + no máximo uma em voo
  (`flushEditorContext` em `App.tsx` é a referência).
- **Toda lista que cresce tem teto.** O console da pré-visualização corta em 200 linhas
  (`PreviewPanel.tsx:28`); o histórico do chat **não** tem teto — é crescimento sem
  limite conhecido. Virtualizar só depois de medir que a lista é o gargalo.
- **Fontes remotas num app offline.** `variants/desktop/index.html` carrega Inter e Fira
  Code de `fonts.googleapis.com`. Sem internet isso é uma requisição que falha e cai no
  fallback do sistema, mudando as métricas da UI. O certo é servir as fontes do bundle
  (`@font-face` com arquivo local) ou assumir o fallback de propósito — hoje é o
  primeiro caso sem estar decidido.
- **Imagem**: local, com dimensão declarada (`width`/`height` ou `aspect-ratio`) para não
  deslocar layout. Nada de imagem remota em chrome de app offline.
- **Animação**: `transform`/`opacity`, e devagar. `backdrop-filter` é caro no
  WebKitGTK — há um `backdrop-blur-sm` no overlay de modal (`App.tsx`); não espalhe.
- **`will-change`** só enquanto a animação dura; deixá-lo permanente custa memória.
- **Preferir CSS a JS no caminho de scroll/resize**; handler de `scroll` que chama IPC é
  o pior caso das duas regras acima.

## Antes de dizer que melhorou

1. Número antes e depois (`build:desktop` e/ou tempo até a UI responder com o agente em
   voo).
2. Nada de regressão funcional: `npm run typecheck` e o app abrindo.
3. Se não foi possível medir, escreva **"não medido"** — não converta a intenção em
   resultado.
