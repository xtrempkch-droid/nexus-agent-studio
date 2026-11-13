---
description: "Padrão visual e de acessibilidade da UI do editor: tokens, hierarquia, foco, contraste, overflow e estado de espera"
applyTo: "variants/desktop/src/**"
---

# Design system da UI desktop

A UI é React 19 + Tailwind v4 no WebView do Tauri. Ela sustenta três coisas ao mesmo
tempo: um editor de código, um painel de agente e um painel de saída. O padrão abaixo é
o que já está em uso — siga, em vez de introduzir um segundo vocabulário visual.

## Tokens

Definidos em `variants/desktop/src/styles/theme.css` (`@theme`), consumidos como
`bg-ide-card`, `text-ide-accent`, `border-ide-border`, e as fontes
`font-sans` (Inter) / `font-mono` (Fira Code).

- **Um acento** (`ide-accent`, índigo). Vermelho/âmbar/verde são **estado**
  (erro/atenção/ok), nunca decoração.
- Utilidades próprias do projeto: `scrollbar-ide` (scrollbars finas, obrigatória em
  qualquer área rolável) e `glow-*` (só para destaque pontual).
- Não introduza biblioteca de componentes: o bundle é dependency-free de propósito
  (`docs/architecture.md` §6). Ícone novo = entrada nova em `components/Icon.tsx`, com
  `aria-hidden="true"`.
- Hoje há bastante `slate-*`/`indigo-*` cru convivendo com os tokens. Em código **novo**,
  prefira o token quando a cor existe; converter o legado é tarefa própria (`/tailwind`),
  não efeito colateral de outra mudança.

## Acessibilidade — o piso que este app consegue cumprir

- **Botão só com ícone tem `aria-label`.** Já é o padrão (fechar aba, fechar modal,
  configurações): mantenha, inclusive nas ações novas.
- **A barra de abas do painel inferior ainda não é um tablist de verdade.** Hoje são
  `<button>` com estado visual apenas. Ao mexer nela, o alvo é
  `role="tablist"` + `role="tab"` com `aria-selected`, `tabIndex` róving e navegação
  com ← →; `role="tabpanel"` + `aria-labelledby` no conteúdo.
- **Anúncio de mudança assíncrona** usa `role="status"` + `aria-live="polite"` — como
  `StatusBadge.tsx`. O streaming do agente e o resultado de uma tool são o próximo caso.
- **Nunca só cor.** Estado tem texto e/ou emoji além da cor (ver `StatusBadge`).
- **Foco visível** em botões e links: não use `focus:outline-none` sem substituir por
  um anel (`focus-visible:ring-2 ring-ide-accent`). Em `<input>`/`<textarea>`, trocar a
  borda no `focus` é aceitável, porque o campo mostra o cursor.
- **Contraste no escuro:** `text-slate-500` sobre `bg-ide-bg` está no limite para texto
  pequeno — use `text-slate-400` (ou token) para informação que precisa ser lida, e
  reserve `-500` para rótulo secundário.
- **Alvo de clique ≥ 24 px** (os botões de aba e os de fechar já estão nessa faixa).

## Layout e overflow — a regra que nasceu de um bug

Qualquer painel, modal ou lista que possa crescer além da viewport precisa de limite
**e** rolagem: `max-h-[70vh] overflow-y-auto scrollbar-ide` (ou equivalente). O
formulário de configurações já ficou fora da tela, com o botão Salvar inalcançável,
porque cresceu (lista de modelos) sem limite. Use `flex` + `min-h-0` nas cadeias
roláveis: sem `min-h-0`, um `flex-1` não encolhe e o `overflow` não atua.

Hierarquia: 4/8 px para espaçamento interno, 12–24 px entre blocos, uma elevação
(`bg-ide-card` + `border`). Não empilhe dois níveis de card para separar.

## Espera e falha

- Operação longa mostra **progresso e texto do que está acontecendo** ("aguardando o
  modelo…"), não só um spinner mudo — o usuário precisa saber que o app está vivo e o
  que ele está esperando.
- Ação destrutiva ou irreversível confirma antes; erro aparece onde a ação aconteceu e
  diz o que fazer, não só `Error: …`.
- Nunca bloqueie a UI esperando o core: `App.tsx` faz *debounce* e mantém no máximo uma
  chamada em voo (`flushEditorContext`). Chamada por evento enfileira no worker e o app
  parece travado.

## Verificação

`npm run typecheck` e `npm run build:desktop`. Os testes da suíte rodam em
`environment: node` — só a lógica pura de `src/lib/**` é testável; componente se
verifica abrindo o app. Se você não abriu, diga isso.
