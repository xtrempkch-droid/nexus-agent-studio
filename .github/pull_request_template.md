<!--
Obrigado pela contribuição! Preencha o checklist — ele reflete as regras em
AGENTS.md e os invariantes descritos em docs/PROJECT_STATE.md §7.
-->

## O que muda

<!-- Resumo objetivo e o porquê. -->

## Área afetada

- [ ] `common/` (core headless)
- [ ] `common/mcp/` (server ou tools)
- [ ] `common/docker/` (sandbox, parser)
- [ ] `common/plugins/`
- [ ] `variants/desktop/`
- [ ] `docs/` / `.github/` / tooling

## Checklist

- [ ] **Não inventei APIs** — cada API externa nova foi conferida na documentação
      oficial da versão do `package.json` (ou emiti `VERIFICATION REQUIRED`).
- [ ] `common/` continua **headless**: sem DOM, sem React, sem `window`/`document`.
- [ ] `variants/desktop` importa do core **apenas tipos** (`import type`).
- [ ] Imports relativos com extensão `.ts`/`.tsx`; nenhum `baseUrl` introduzido.
- [ ] `stdout` não é usado para log no core (só `console.error`).
- [ ] Testes adicionados/atualizados para mudança pública no core.
- [ ] `npm run lint && npm run typecheck && npm run test && npm run build` passou
      (localmente **ou** no workflow `build`).
- [ ] Atualizei `docs/PROJECT_STATE.md` (§2 status, §5 próximos passos, commit de
      referência).

## Como testar

<!-- Passos para reproduzir a verificação. -->
