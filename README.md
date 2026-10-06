# NexusAgent Studio

A multiplatform, high-performance code editor core with an **internal MCP server**,
an **event-sourced execution logger**, a **Docker terminal sandbox** and a
**dynamic plugin system**.

The headless core lives in `common/` (no DOM, no React). UI/platform targets live
in `variants/`.

**Retomando o projeto?** Leia [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) — é
o arquivo de rastro com status, bloqueios e próximos passos. Agentes de IA devem ler
também [`AGENTS.md`](AGENTS.md). Arquitetura em
[`docs/architecture.md`](docs/architecture.md); roadmap em
[`docs/roadmap.md`](docs/roadmap.md).

---

## Stack Declaration

Every version below was verified against the official npm registry and the
official MCP TypeScript SDK v2 documentation on **2026-10-05**. Nothing here is
assumed.

| Dependency | Version | Import path / notes |
| --- | --- | --- |
| `@modelcontextprotocol/server` | `^2.3.1` | `import { McpServer } from '@modelcontextprotocol/server'` — **v2 stable** (spec `2026-07-28`), Apache-2.0, `node >= 20` |
| `@modelcontextprotocol/server/stdio` | `^2.3.1` | `import { serveStdio } from '@modelcontextprotocol/server/stdio'` — takes a **factory** `() => McpServer`, returns `StdioServerHandle.close()` |
| `@modelcontextprotocol/client` | `^2.3.1` | `import { Client } from '@modelcontextprotocol/client'` |
| `@modelcontextprotocol/core` | `^2.3.1` | Required peer of `server` |
| `zod` | `^4.6.5` | `import * as z from 'zod/v4'` (canonical Zod 4 subpath) |
| `react` / `react-dom` | `^19.3.0` | Desktop UI. **There is no React 20.** |
| `tailwindcss` | `^4.3.3` | CSS-first `@theme`, no `tailwind.config.js`. **There is no Tailwind 5.** |
| `typescript` | `~6.0.2` | Compiler toolchain. **Not 7.x** — see the note below. |
| `esbuild` | `^0.28.2` | Core bundler |
| `vite` | `^8.3.2` | Desktop variant bundler |
| `vitest` | `^5.0.3` | Tests |
| `eslint` + `typescript-eslint` | `^10.12.0` / `^8.71.1` | Flat config |
| Node.js | `>=22` | CI matrix: 22 (LTS), 24 (Active LTS) |
| Docker Engine | pin for reproducibility | Isolation is enforced by CLI flags + default seccomp. See `docs/architecture.md` §5 regarding CVE-2026-31431. |

### Deprecated / must not use

- `@modelcontextprotocol/sdk` is the **v1 legacy** line (latest `1.32.1`,
  implements the spec up to `2025-11-25`). It is not used anywhere in this
  repository. v2 ships as the separate `@modelcontextprotocol/server` and
  `@modelcontextprotocol/client` packages.

### Verification notes

- **TypeScript is pinned to `~6.0.2`, not 7.x.** `typescript-eslint@8.71.1`
  declares `peerDependencies.typescript: ">=4.8.4 <6.1.0"`. TypeScript 7.0.2 falls
  outside that range, so `npm install` aborts with `ERESOLVE` and **no CI step ever
  runs** (lint/typecheck/test/build are all skipped). `~6.0.2` means
  `>=6.0.2 <6.1.0`, which matches the peer range exactly and still ships the real
  `tsc` binary. Do not widen this range without re-checking that peer.
- `@typescript/typescript6@6.0.2` exists, but it exposes its binary as **`tsc6`**,
  not `tsc` — so aliasing `typescript` to it would break `npm run typecheck`.
- With TypeScript ≥ 6, `@types/*` is no longer auto-included, so `tsconfig.json`
  sets `"types": ["node"]`.
- `serveStdio` receiving a **server instance** instead of a factory is the most
  common v1→v2 migration mistake; this repo always passes a factory.

---

## Getting started

```bash
npm install          # install dependencies
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
npm run lint         # eslint .
npm run build        # typecheck + bundle the Node core to dist/core.mjs
npm run dev:desktop  # run the desktop variant (Vite)
```

If Node.js is not available on your machine, **GitHub is the build environment**:
push a branch and the `build` workflow runs `lint → typecheck → test → build` on a
3-OS × 2-Node matrix. To produce the initial `package-lock.json` without a local
Node install, run the **bootstrap-lockfile** workflow (Actions → Run workflow) and
commit the `package-lock` artifact; then switch the install step back to `npm ci`
and re-enable `cache: npm`.

The core is a stdio MCP server. It must **never** write logs to stdout — stdout is
the JSON-RPC channel. Use `console.error` for diagnostics.

## Layout

- `common/` — headless core (MCP server + tools, logger, docker, plugins, themes)
- `variants/desktop/` — React 19 + Tailwind v4 editor shell
- `plugins/` — first-party plugins implementing `PluginLifecycle`
- `layout/` — static HTML design references (excluded from the build)

## License

Apache-2.0.
