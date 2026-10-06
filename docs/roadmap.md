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

- [ ] LSP bridge (`variants/desktop`) using the same MCP tools
      - [x] Core LSP client (`common/lsp/`) — framing, diagnostics→hints, JSON-RPC
            client, stdio transport, document lifecycle
      - [ ] Expose `get_diagnostics` as an MCP tool
      - [ ] UI wiring (Tauri commands to configure/start the language server)
- [ ] WASM compile target for `common/` (requires DOM-free audit)
- [ ] Plugin marketplace with signature verification (`*.plg` signed bundles)
- [ ] Remote MCP over Streamable HTTP for team workspaces
- [ ] DAP integration for step debugging inside the sandbox
