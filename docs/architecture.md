# NexusAgent Studio — Architecture

> Technical reference for the multiplatform code editor core.

## 1. Repository layout

```
common/            Headless, UI-agnostic core (no DOM, no React)
  agent/           LLM loop: prompt-built tool calling, streaming, step budget
  debug/           Event-sourced ExecutionLogger + inline hints
  docker/          Docker sandbox runner, local (unisolated) runner, error parser
  lsp/             Language Server Protocol client, transport, manager
  mcp/             InternalMCPServer + MCP tools
  plugins/         Plugin contracts + PluginManager
  security/        Path traversal guard
  themes/          Reactive ThemeManager
variants/          UI/platform targets built on top of common/
  desktop/         React 19 + Tailwind v4 desktop shell (runs in the webview)
src-tauri/         Rust host: owns the window and the single core session
  src/bridge.rs    Process plumbing (spawn, boot detection) — Tauri-free
  src/mcp.rs       MCP client over the child's stdio — Tauri-free
  src/worker.rs    Request queue in front of the session — Tauri-free
  src/main.rs      Tauri commands; the only file needing the GTK stack
  harness/         Standalone crate that compiles the Tauri-free modules to test them
plugins/           First-party plugins (.plg.ts) using the plugin contract
scripts/           smoke-mcp.ts, env-probe.sh
layout/            Static HTML design references (not part of the build)
docs/              This documentation
```

## 2. `common/` — the headless core

`common/` is the single source of truth for behaviour. It has **no DOM and no UI
dependency**: it runs identically in an Electron/Tauri main process, a Node
worker, a test runner, or (partially) a browser/WASM target.

Public surface is re-exported from `common/index.ts`:

| Module | Responsibility |
| --- | --- |
| `common/mcp/server.ts` | `InternalMCPServer`, a lifecycle wrapper over the MCP v2 `McpServer` factory |
| `common/mcp/tools/*` | Built-in tools: file I/O, editor context, Docker terminal, LSP, models, agent |
| `common/agent/*` | The LLM loop — prompt-built tool calling, streaming, step budget |
| `common/lsp/*` | LSP client (transport-agnostic), stdio transport, diagnostics → hints |
| `common/debug/logger.ts` | Immutable, append-only `ExecutionLogger` (event sourcing) |
| `common/docker/*` | Container isolation, resource limits, stream separation, error parsing |
| `common/plugins/*` | `PluginManifest` / `PluginContext` / `PluginLifecycle` + `PluginManager` |
| `common/themes/*` | Pub/Sub theme token store for UI + syntax highlighting |
| `common/security/*` | Workspace-confined path resolution |

### 2.1 Why a factory-based MCP server

MCP v2's `serveStdio(factory)` calls a **factory** once per connection to build
the server instance that serves that connection. `InternalMCPServer` therefore
does not own a long-lived `McpServer`; it owns the *registrations* and builds a
fresh instance on demand:

```
InternalMCPServer (holds tool registrations)
        │  build()
        ▼
   new McpServer(...)  ──►  serveStdio(() => server)  ──►  StdioServerHandle
```

This is what makes dynamic plugin tool injection possible: a plugin can
`registerDynamicTool(...)` at any time, and the next `build()` picks it up.

## 3. Compilation strategy for `variants/`

`variants/` targets are thin. They depend on `common/` but never the reverse.

| Target | Runtime | Build | Notes |
| --- | --- | --- | --- |
| `desktop` | Electron / Tauri shell + Chromium | Vite | React 19, Tailwind v4 CSS-first `@theme` |
| `web` (planned) | Browser / WASM | Vite + wasm-pack | `common/` must stay DOM-free to allow `wasm32` compilation |
| CLI (planned) | Node.js | esbuild | Direct `common/` import |

The Node core is bundled with esbuild (`npm run build`), keeping `node_modules`
external (`--packages=external`) so native/alpha dependencies resolve at
runtime. The desktop variant is bundled with Vite.

## 4. Communication flow

**The UI never talks to the core directly.** The webview cannot: the core is a
Node process reached over stdio, and `node:*` does not exist in a browser. Every
call crosses the Tauri boundary into the Rust host, which owns the single core
session and queues requests in front of it.

```mermaid
flowchart LR
    subgraph UI["variants/desktop (React, in the webview)"]
        Chat[Agent Chat]
        Term[TerminalOutput]
        Exp[File Explorer]
    end

    subgraph Shell["src-tauri (Rust host)"]
        Cmd["commands:\ncall_core_tool, pick_workspace, ..."]
        Queue["CoreWorker:\none thread, FIFO queue"]
    end

    subgraph Core["common/ (headless, Node process)"]
        MCP[InternalMCPServer]
        Agent[agent loop]
        LSP[lsp bridge]
        Log[ExecutionLogger]
        Hints[InlineHintManager]
        Theme[ThemeManager]
    end

    subgraph Sandbox["Docker Sandbox"]
        Container[("container")]
    end

    UI -->|"lib/shell.ts\n(window.__TAURI__)"| Cmd
    Cmd --> Queue
    Queue -->|"stdio: newline-delimited JSON-RPC"| MCP
    MCP --> Agent
    MCP --> LSP
    MCP -->|write_file| Log
    MCP -->|run_terminal_command| Container
    Container -->|stdout / stderr| Parser[Compiler Error Parser]
    Parser -->|diagnostics| Hints
    Parser -->|exit code, duration| Log
    Log -->|subscribe| Term
    Hints -->|getHintsForFile| Chat
    Theme -->|pub/sub tokens| UI
    Queue -.->|"notifications/agent/stream\n(Tauri events)"| UI
```

1. The UI calls a shell command through `lib/shell.ts` — the **only** module that
   knows how the webview reaches the host. In a plain browser nothing is injected
   and every call rejects, which is what lets the UI degrade honestly.
2. The command becomes a **job** on the worker's queue. The worker owns the core
   session, holds nothing while the core works, and answers in submission order —
   see `worker.rs` for why the budget is measured from submission.
3. File mutations are recorded as immutable `LogEntry` objects by the
   `ExecutionLogger` (`author: 'AI' | 'USER' | 'SYSTEM'`).
4. `run_terminal_command` hands the command to the Docker sandbox, which
   enforces isolation flags, captures **stdout and stderr separately**, and
   returns exit code + wall-clock duration.
5. Compiler output from `stderr` is parsed; each diagnostic is attached as an
   `InlineHint` at the exact file/line, and the container run is recorded in the
   logger.
6. UI subscribers re-render from the event stream — nothing polls. Agent stream
   deltas arrive the other way, as core **notifications** forwarded to webview
   events, so streaming never competes with a pending request.

## 5. Security model

- **Path confinement** — every file tool resolves through
  `resolveWorkspacePath()`, which rejects absolute paths outside the workspace
  root and any `..` escape (also after `symlink`-free normalization).
- **Atomic writes** — `write_file` writes to a temp file in the same directory
  and `rename()`s it, so a crash never leaves a half-written file.
- **Container isolation** — `--rm --cap-drop=ALL --security-opt=no-new-privileges
  --memory=512m --cpus=1.0`, optional `--network=none`, workspace mounted at
  `/workspace` with `-w /workspace`.
- **Least privilege** — the sandbox container never receives the Docker socket,
  the host home directory, or SSH agent forwarding.
- **AF_ALG / seccomp** — Docker's default seccomp profile blocks `AF_ALG`
  sockets, which neutralises the class of page-cache write issues seen in
  CVE-2026-31431 (`algif_aead`). We keep the default profile and additionally
  drop all capabilities. The fix for that CVE is a **kernel** patch; Docker
  version pinning is for reproducibility, not for the mitigation.

## 6. Dependency policy

See the **Stack Declaration** in `README.md`. Every external API used in this
repository was verified against its official documentation before use. The
current verified set is:

- `@modelcontextprotocol/server` / `client` / `core` — **v2** (spec 2026-07-28)
- `zod` v4 via the `zod/v4` subpath
- `typescript` **`~6.0.2`** — **not 7.x.** `typescript-eslint@8` declares
  `peerDependencies.typescript: ">=4.8.4 <6.1.0"`, so TS 7 makes `npm install` abort
  with ERESOLVE and every later step is skipped. See `README.md` for the full note.
- `react` 19.x (there is no React 20)
- `tailwindcss` 4.x CSS-first `@theme` (there is no Tailwind 5)

## 7. Testing

### TypeScript

`vitest` runs against `common/**` and `plugins/**` in Node. The Docker sandbox
takes an injectable command executor (`CommandExecutor`) so tests can assert the
exact `docker run` argv without a daemon — which is also why the unit tests could
not notice that the argv was missing the `docker` binary itself (see
`docs/PROJECT_STATE.md` §3, item 25). **That is the lesson worth keeping:** a test
whose only subject is a double has verified the double. Changes to argv, or to any
contract with an external process, need at least one test that runs a real one.

### Rust

The three Tauri-free modules (`bridge.rs`, `mcp.rs`, `worker.rs`) are compiled by a
standalone crate in `src-tauri/harness`, which pulls them in by `#[path]` so there
is no copy to drift:

```sh
cd src-tauri/harness && cargo test      # seconds; needs only cargo
```

`main.rs` — the Tauri command layer — **cannot** be built there: it needs the GTK
and WebKitGTK development packages, a system-level install. It is compiled and
type-checked by the `tauri` workflow in CI, which is also what runs the
`#[ignore]`d end-to-end handshake against the real core.

So the boundary is: **a change confined to the three modules is verifiable
locally; a change touching `main.rs` needs CI.** `rustfmt` will at least parse
`main.rs` without any dependencies, which catches syntax errors before a push.
