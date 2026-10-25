---
description: "Reduz classes Tailwind redundantes e unifica tokens de design — no Tailwind v4 CSS-first deste projeto, sem mexer no visual"
name: "tailwind"
argument-hint: "componente ou pasta (vazio = varredura com relatório de mapeamento, sem aplicar)"
agent: "agent"
---

## Como o Tailwind funciona **aqui** (v4, não v3)

- `tailwindcss@^4.3.3` **CSS-first**: não existe `tailwind.config.js`. O tema está em
  `variants/desktop/src/styles/theme.css` dentro de `@theme { --color-ide-*: … }`, e o
  dark mode é `@custom-variant dark (&:where(.dark, .dark *))`.
- Utilidades próprias vivem em `@layer utilities` no mesmo arquivo (`scrollbar-ide`,
  `glow-indigo|amber|emerald`).
- Pipeline: `npm run build:desktop` (Vite + plugin). **Classe inexistente em JSX não
  quebra o build** — o Tailwind simplesmente não gera CSS para ela. Um erro de nome de
  classe é silencioso; por isso a verificação é visual ou por conferência na doc, nunca
  "compilou, então está certo".

## O achado que justifica a tarefa

Os tokens existem e são pouco usados. Contagem real hoje:

```bash
grep -rho "\b\(bg\|text\|border\|ring\)-slate-[0-9]*" variants/desktop/src --include=*.tsx | wc -l   # ~300
grep -rho "\b\(bg\|text\|border\|ring\)-ide-[a-z]*"   variants/desktop/src --include=*.tsx | wc -l   # ~9
```

Ou seja: `bg-ide-card`/`text-ide-*` estão definidos em `theme.css` e o código usa
`bg-slate-950`/`text-slate-200`. Unificar é uma tarefa **real e separada** — não
pendure a renomeação de 300 ocorrências numa mudança de feature.

## Mapeamento (derive o resto conferindo `theme.css`)

| Cru | Token | Cores (cru → token) | Igual? |
| --- | --- | --- | --- |
| `bg-slate-950` | `bg-ide-bg` | `#020617` → `#0b0f19` | **não** |
| `bg-slate-900` | `bg-ide-card` | `#0f172a` → `#131b2e` | **não** |
| `border-slate-800` | `border-ide-border` | `#1e293b` → `#1d283a` | quase |
| `bg-indigo-500` / `hover:bg-indigo-600` | `bg-ide-accent` / `-hover` | `#6366f1` / `#4f46e5` | **sim** |
| `text-emerald-400` / `text-amber-400` / `text-red-400` | `text-ide-green` / `-yellow` / `-red` | `#34d399` → `#10b981` etc. | **não** |

**Antes de trocar uma classe, prove a equivalência de cor** — a tabela mostra que quase
nenhuma é exata. O caminho honesto é decidir qual tom é o certo (o token, provavelmente)
e então ajustar **o token** ou a classe, sabendo que o pixel muda; nunca reutilizar um
token de tom diferente só porque o nome parece o mesmo.

## Regras de redução

- Só remova redundância **semântica** (`px-2 px-4` → `px-4`; `flex` + `flex-row`).
- Não mexa em valores arbitrários deliberados (`text-[13px]` é escolha, não descuido).
- Não introduza `!important` para ganhar uma disputa de especificidade.
- `cn()`/`clsx` não existem aqui: condicional é template string — confira as duas
  pontas de cada `? :` antes de mexer.
- Nunca junte classes que mudam a ordem de cascata entre um componente e outro.

## Verificação

```bash
npm run build:desktop     # gera o CSS; confira que as classes usadas aparecem no bundle
npm run typecheck
```

Se puder abrir o app, compare as telas afetadas antes/depois — é a única prova de que o
visual não mudou. Se não puder, **diga** que a verificação foi só o build.

Entrega: tabela `arquivo:linha → antes → depois → equivalente?`, o patch, e a lista do
que ficou pendente porque mudaria a cor.
