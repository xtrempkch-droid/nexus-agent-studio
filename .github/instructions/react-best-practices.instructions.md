---
description: "Padrões de React 19 para este app (Vite + WebView, sem SSR): estado no lugar certo, listas estáveis, efeitos com limpeza, entrada controlada e fronteira com o IPC"
applyTo: "variants/desktop/src/**/*.tsx"
---

# React neste projeto

Este app é uma SPA React 19 montada por Vite dentro do WebView do Tauri. **Não há**
Next.js, Server Components, RSC, streaming SSR, `use server`, rota por arquivo nem
`next/image` — receita de Next aplicada aqui é ruído. O que se aplica é o que segue.

## Estado

- **O estado mora no componente mais próximo que precisa dele.** `App.tsx` (1.844
  linhas) concentra muito estado por história, não por desenho: em código novo, não
  acrescente mais um `useState` ali sem perguntar se ele pertence ao componente da
  aba.
- **Derive, não sincronize.** Se `X` pode ser calculado de `Y`, calcular vence
  `useEffect` que copia `Y` para `X` — o efeito cria um quadro intermediário
  inconsistente e um bug de ordem.
- **Uma fonte de verdade por dado.** Já existe precedente caro: o workspace vivia em
  dois lugares e o cabeçalho passou a nomear um projeto que o core não servia.
- **Estado de UI ≠ estado do core.** Settings que o core precisa são enviados
  explicitamente; a UI não lê arquivo nem variável de ambiente para "descobrir".

## Listas

- **`key` estável e do dado** (`key={tab}`), nunca `key={index}` em lista que reordena
  ou cresce — foi o que faria a linha errada do console da pré-visualização parecer a
  certa. `PreviewPanel` corta em 200 linhas (`MAX_LINES`), mantenha o corte dentro do
  mesmo `setState` funcional.
- Lista que cresce sem teto é bug de memória: o histórico do chat hoje **não** tem
  teto (dívida registrada no roadmap).

## Efeitos

- Efeito que assina algo **devolve a limpeza** (listener, intervalo, subscription).
- Cadeia de dependências incompleta é a origem do valor obsoleto: se você não pode
  listar a dependência, o efeito provavelmente é um cálculo derivado.
- **Nunca dispare chamada ao core por evento.** `App.tsx` faz debounce e mantém no
  máximo uma chamada em voo (`flushEditorContext`) porque a sessão do core é
  serializada: cada tecla vira requisição em fila e a UI parece travada.
- `useEffect` no `mount` para carregar dados é aceitável; para sincronizar dois
  estados, não.

## Entrada e eventos

- Input controlado (`value` + `onChange`) ou não controlado — nunca os dois; o React
  avisa e a UI pisca.
- `Ctrl+Enter`/`Enter` em campo de texto: o handler que envia mensagem faz
  `event.stopPropagation()`, senão o atalho global também dispara (já aconteceu: enviar
  mensagem e trocar de aba no mesmo Enter).
- Handler global (`window.addEventListener`) mora em um efeito com limpeza, e lê o
  valor atual por ref/`useEffectEvent` — não capture estado velho no closure.

## Performance (o que importa num WebView)

- `useMemo`/`useCallback` só onde há medição ou onde a identidade estável é
  **necessária** (dependência de efeito, prop de `memo`). Embrulhar tudo é ruído.
- Não anime propriedades de layout; use `transform`/`opacity`.
- `backdrop-filter` é caro no WebKitGTK — existe **um** `backdrop-blur-sm` (overlay de
  modal); não espalhe.

## Fronteira com o Tauri

- Só `lib/shell.ts` conhece `window.__TAURI__`. Componente importa de lá, nunca
  `window.__TAURI__` direto — é o que mantém a UI renderizável no navegador para
  `/playwright-browser`.
- `lib/coreClient.ts` desembrulha o envelope das tools. Não replique esse
  desembrulho em componente: uma segunda cópia divergirá do formato do core.
- Todo `invoke` pode rejeitar: trate com mensagem na tela, não `console.error` mudo.

## Acessibilidade e aparência

`aria-label` em botão só de ícone, `role="status"` + `aria-live` para mudança
assíncrona, foco visível, e a regra de overflow (`max-h-[70vh] overflow-y-auto
scrollbar-ide` + `min-h-0` nas cadeias `flex`) estão em
[frontend-design](./frontend-design.instructions.md) — leia antes de montar tela nova.
