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
- [x] Re-verified on the notebook (2026-10-07), now that its Docker is reachable:
      the exact argv runs, files come out owned by the caller, all capabilities are
      dropped, the network is blocked, `--rm` cleans up — and items 27/28 turned out
      to be limitations of a *different* host, not of the product. See §3 item 30.
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
- [x] Merge the functions `Duck-Hermes-Studio` had and this project did not:
      `edit_file` (surgical, all-or-nothing), `web_fetch` / `web_search` behind an
      SSRF policy and `NEXUS_WEB_ACCESS`, project memory in `AGENTS.md`
      (`remember_project_fact` / `recall_project_memory`), preview panel with
      console capture (HTML / Markdown / JSON / text)
- [ ] Preview for binary files (images, PDF) — the core reads text only, so this
      needs a base64 read path first
- [ ] Preview assets: serve the workspace so a page's own `style.css` and images
      load (today only self-contained HTML previews correctly)
- [x] Agent commands and per-file instructions — `.github/prompts/*.prompt.md`
      (14 slash commands) + `.github/instructions/` (`frontend-design`,
      `web-performance`), indexed in `docs/AGENT_SKILLS.md`. Audited first: the
      verification gate, code review, CI/CD and the environment probe already
      existed without a command name, so they were pointed at rather than
      duplicated.
- [ ] Findings that audit surfaced, each its own task:
      - [ ] Bundle Inter/Fira Code instead of loading them from Google Fonts —
            an offline app currently makes a doomed remote request (`index.html`)
      - [ ] Make the bottom tab bar a real `role="tablist"` with arrow-key
            navigation (today: plain buttons, `aria-selected` absent)
      - [ ] Unify the icon buttons' focus ring (`focus-visible:ring-2`) — several
            use `focus:outline-none` with a border change only
      - [ ] Cap the chat history (the preview console is capped at 200 lines; the
            conversation is not)
      - [ ] Convert the ~300 raw `slate-*`/`indigo-*` utilities to the `--color-ide-*`
            tokens (9 uses today) — decide the palette first, since most tones differ
      - [ ] **Symlink escape in `common/security/pathGuard.ts`.** The guard resolves
            *lexically* (`normalize` + `relative`, no `realpath`), so `link/passwd`
            with `link -> /etc` is inside the root as a string and followed on read.
            Found while writing `/threat-model`; not fixed there on purpose (it is a
            behaviour change in security-critical code and needs its own test with a
            real symlink, which only Windows-vs-POSIX tests will tell apart).
            **Reproduced**, not theorised: with `ws/link.txt -> /tmp/secret.txt`,
            `resolveWorkspacePath(ws, 'link.txt')` returns the path and
            `readFileSync` returns the outside content. Fix direction:
            `realpath` the target when it exists (and the parent when creating),
            then re-check containment — plus a POSIX-only test that skips on
            Windows, where creating symlinks needs privileges.
- [ ] Request queue in the sidecar instead of the blocking session mutex —
      `src-tauri/src/worker.rs` owns the session on one thread, handles requests in
      submission order, and holds nothing while the core works. A slow turn no
      longer blocks every other tool; a request that spends its budget queued is
      refused without being sent, and says so.
- [ ] WASM compile target for `common/` (requires DOM-free audit)
- [ ] Plugin marketplace with signature verification (`*.plg` signed bundles)
- [ ] Remote MCP over Streamable HTTP for team workspaces
- [ ] DAP integration for step debugging inside the sandbox
