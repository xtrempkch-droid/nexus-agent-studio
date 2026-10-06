# NexusAgent Studio — Roadmap

## Phase 1 — Repository infrastructure ✅

- [x] Monorepo layout (`common/`, `variants/`, `plugins/`)
- [x] CI matrix (Ubuntu / Windows / macOS × Node 22, 24)
- [x] Issue templates + CODEOWNERS
- [x] Architecture documentation

## Phase 2 — Core engine in TypeScript ✅

- [x] `common/mcp` — `InternalMCPServer` + built-in tools
- [x] `common/debug` — `ExecutionLogger` (event sourcing) + inline hints
- [x] `common/themes` — reactive `ThemeManager`

## Phase 3 — Docker terminal sandbox ✅

- [x] `common/docker/sandbox.ts` — isolation flags, resource limits, `--rm`
- [x] `common/docker/compilerErrorParser.ts` — GCC/Clang, TS, Rustc
- [x] `run_terminal_command` tool + logger container records
- [x] `TerminalOutput.tsx` — ANSI highlighting + reactive status badge

## Phase 4 — Plugin architecture ✅

- [x] `PluginManifest` / `PluginContext` / `PluginLifecycle`
- [x] `registerDynamicTool` / `unregisterToolsByPlugin`
- [x] `PluginManager` with isolated lifecycle error handling
- [x] Example plugin: `plugins/git-helper.plg.ts` (`git_blame_docker`)

## Phase 5 — Build system ✅

- [x] Root `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`
- [x] `npm run lint | typecheck | test | build`
- [x] Vite build for the desktop variant

## Next

- [x] LSP bridge (`variants/desktop`) using the same MCP tools
      - [x] Core LSP client (`common/lsp/`) — framing, diagnostics→hints, JSON-RPC
            client, stdio transport, document lifecycle
      - [x] `get_diagnostics` / `configure_language_server` / `list_language_servers`
            MCP tools + `LanguageServerManager` orchestration
      - [x] UI wiring (check button, auto-check on open/save, settings section)
- [ ] Feed `get_editor_context` from the UI (cursor/selection are still not pushed)
- [ ] WASM compile target for `common/` (requires DOM-free audit)
- [ ] Plugin marketplace with signature verification (`*.plg` signed bundles)
- [ ] Remote MCP over Streamable HTTP for team workspaces
- [ ] DAP integration for step debugging inside the sandbox
