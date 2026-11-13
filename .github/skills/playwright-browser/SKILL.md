---
name: playwright-browser
description: 'Abre a UI num navegador de verdade e valida o que build e teste de Node não cobrem: screenshot, DOM renderizado e console. Use when: mudou UI/React/Tailwind, ou é preciso provar que a tela renderiza em vez de só compilar.'
argument-hint: 'URL ou vazio (vazio = sobe o dev server e usa http://localhost:5173/)'
---

# Ver a tela, não só compilar

Este é o único jeito de saber que a UI renderiza. `npm run build:desktop` prova que o
bundle compila; `vitest` roda em `environment: node`, então não há DOM em teste
nenhum — componente só se verifica abrindo. E "compilou" não é "renderizou": uma
classe Tailwind inexistente não quebra o build, o CSS simplesmente não é gerado.

## Dois caminhos (o segundo não instala nada)

**A. Playwright, se já estiver no projeto.** Verifique antes de prometer:

```bash
node -e "console.log(require.resolve('playwright'))" 2>/dev/null || echo "playwright: ausente"
```

Ausente, **não instale por conta própria**: dependência nova exige decisão (política
`docs/architecture.md` §6) e `package-lock.json` regenerado (workflow
`bootstrap-lockfile`). Pergunte.

**B. Chromium headless do sistema — zero dependência, e é o caminho verificado aqui:**

```bash
sh .github/skills/playwright-browser/scripts/ui-shot.sh http://localhost:5173/ /home/$USER/ui.png
sh .github/skills/playwright-browser/scripts/ui-shot.sh http://localhost:5173/ /home/$USER/ui.html dom
```

O script escolhe o primeiro navegador que existir (`chromium`, `chromium-browser`,
`google-chrome`, `/snap/bin/chromium`, `microsoft-edge`), tira screenshot ou despeja
o DOM, e falha com mensagem clara se não houver navegador.

## Procedimento

1. **Suba o dev server** e confirme que respondeu (não presuma):

```bash
npm run dev:desktop -- --port 5199 --strictPort > /home/$USER/vite.log 2>&1 &
sleep 5; curl -s -o /dev/null -w "http %{http_code}\n" http://localhost:5199/
```

2. **Screenshot** (`ui-shot.sh … png`) e **DOM** (`… dom`). O DOM é a prova textual:
   `grep -c "Pré-visualização" ui.html` diferente de zero significa que a aba existe de
   verdade. Verificado nesta máquina: 58 KB de DOM, com `Agente`, `Terminal`,
   `Alterações` e `Pré-visualização` presentes.
3. **Console.** `chromium --dump-dom` não mostra console; para capturar erro de
   runtime use `--enable-logging=stderr --v=1` e filtre `CONSOLE`, ou o Playwright do
   caminho A. Diga qual você usou.
4. **Mate só o seu PID.** `kill <pid>` do processo que você criou; **nunca**
   `pkill`/`killall` por nome (há outros servidores na máquina — matar por nome mata o
   do dono). Limpe o log e os artefatos no fim.

## Pegadinhas que já custaram tempo aqui

- **`/tmp` é privado no snap.** `/snap/bin/chromium --screenshot=/tmp/x.png` responde
  "bytes written" e o arquivo **não aparece** no `/tmp` real. Grave em `$HOME` ou no
  workspace.
- **Sem a ponte Tauri, o app não abre projeto nem arquivo.** A UI renderiza (é React
  puro), mas "abrir pasta" depende de `lib/shell.ts` → `invoke`. Verificável assim:
  layout, abas, contraste, overflow, estados vazios, texto. **Não** verificável:
  abrir arquivo, rodar tool, LSP, pré-visualização com conteúdo real. Diga a diferença
  em vez de dizer "a UI funciona".
- **`--virtual-time-budget=6000`** dá tempo de montar o React antes do dump. Sem isso
  você fotografa o `<div id="root">` vazio e conclui que "a UI está quebrada".
- **`--no-sandbox`** só é aceitável aqui porque é um Chromium headless local lendo
  `localhost`; não é uma prática para navegador de uso real.

## Quando NÃO usar

- Mudança só no core (`common/`) sem tocar UI.
- Quando o `typecheck` já falha: conserte o build antes de olhar pixel.

## Relatório

Obrigatório, e curto: **URL**, **comando usado**, **tamanho do DOM**, **o que apareceu
no screenshot** (descreva o que você viu, não "parece ok"), **o que não foi exercitado
por falta do shell**, e o caminho do PNG. Se você não conseguiu abrir o navegador,
escreva exatamente isso — a alternativa é a mesma de sempre: dizer que não foi
verificado.
