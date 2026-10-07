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
- [x] Verified against a real daemon, which found two bugs the injected-executor
      tests could not: the argv was missing the `docker` binary, and the container
      ran as root with `--cap-drop ALL` (no `CAP_DAC_OVERRIDE`, so it could not write
      the user's workspace and would have left `root`-owned files there). See
      `PROJECT_STATE.md` §3 items 25–26.
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
- [x] Feed `get_editor_context` from the UI — `set_editor_context` (partial patch,
      debounced caret reporting, `languageId` derived in the core) + UI wiring
- [x] Close editor tabs; give the agent a configurable budget (time, with `0` meaning
      "no deadline", and steps) and report an unfinished turn honestly
- [ ] Request queue in the sidecar instead of the blocking session mutex — a long
      `ask_agent` turn currently serialises every other tool call behind it
- [ ] WASM compile target for `common/` (requires DOM-free audit)
- [ ] Plugin marketplace with signature verification (`*.plg` signed bundles)
- [ ] Remote MCP over Streamable HTTP for team workspaces
- [ ] DAP integration for step debugging inside the sandbox
