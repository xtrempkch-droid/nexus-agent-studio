//! Tauri shell for NexusAgent Studio.
//!
//! This is the desktop **host**: it owns the window and the webview, and it is
//! the only layer allowed to touch the operating system. The editor core is the
//! headless TypeScript package in `common/`; nothing here reimplements it.
//!
//! The shell owns one **long-lived** core session — started lazily by
//! `ShellState::with_core`, restarted if the process died — and exposes it to the
//! webview through a small command surface: `shell_info`, `core_boot_probe`,
//! `core_handshake` and `call_core_tool`.
//!
//! The layers are split so each can be tested without a window: process plumbing
//! lives in `bridge`, the MCP protocol in `mcp`, and this file only wires them to
//! Tauri.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod mcp;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use bridge::{spawn_core, wait_for_boot, CoreConfig};
use mcp::{CoreSession, SessionError};
use serde_json::Value;

/// How long the shell waits for the core to announce itself.
const BOOT_TIMEOUT: Duration = Duration::from_secs(15);

/// How long each step of the MCP handshake may take.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);

/// How long a single tool call may take.
///
/// Generous next to the handshake on purpose: `run_terminal_command` waits on a
/// container, which is slow by nature.
const TOOL_TIMEOUT: Duration = Duration::from_secs(120);

/// State shared with the commands.
struct ShellState {
    /// The directory the shell treats as the project root. Resolved once at
    /// startup, never taken from the webview: a webview cannot be trusted to
    /// name a filesystem path.
    workspace_root: PathBuf,
    /// The single core session, started on first use and reused after that.
    ///
    /// The mutex is not only about thread safety: stdio is one
    /// request/response channel, so calls have to be serialised regardless. The
    /// honest cost is that a slow tool blocks the others, which is why a request
    /// queue belongs on the to-do list rather than in this slice.
    core: Mutex<Option<CoreSession>>,
}

impl ShellState {
    fn new(workspace_root: PathBuf) -> Self {
        Self {
            workspace_root,
            core: Mutex::new(None),
        }
    }

    /// Run `use_core` against a live session, starting or restarting it if needed.
    fn with_core<T>(
        &self,
        use_core: impl FnOnce(&mut CoreSession) -> Result<T, SessionError>,
    ) -> Result<T, String> {
        let mut guard = self
            .core
            .lock()
            .map_err(|_| "the core session lock was poisoned".to_string())?;

        let dead = match guard.as_mut() {
            Some(session) => !session.is_running(),
            None => true,
        };

        if dead {
            // The protocol is stateless and the spec says the client SHOULD
            // restart a server that exited unexpectedly, so a dead core is
            // replaced rather than surfaced as an error.
            *guard = Some(Self::start_core(&self.workspace_root)?);
        }

        let session = guard
            .as_mut()
            .ok_or_else(|| "the core session is unavailable".to_string())?;

        use_core(session).map_err(|error| error.to_string())
    }

    /// Spawn a core and complete the legacy handshake on it.
    fn start_core(workspace_root: &Path) -> Result<CoreSession, String> {
        let config = CoreConfig::for_workspace(workspace_root);
        let child = spawn_core(&config, workspace_root).map_err(|error| error.to_string())?;
        let mut session = CoreSession::start(child).map_err(|error| error.to_string())?;

        if let Err(error) = session.initialize(HANDSHAKE_TIMEOUT) {
            // Never leak a core that failed to handshake.
            let _ = session.shutdown(Duration::from_secs(5));
            return Err(error.to_string());
        }

        Ok(session)
    }
}

/// Identity of the running shell.
///
/// This is the first IPC command, and it exists to prove the
/// webview -> Rust channel works before any real work moves across it.
#[tauri::command]
fn shell_info() -> String {
    format!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"))
}

/// Start the core sidecar and report the line it prints on stderr.
///
/// The child is killed before returning: this is a probe, not the long-lived
/// bridge. It answers "can this machine actually run the core?" with evidence
/// from the real process rather than an assumption.
#[tauri::command]
fn core_boot_probe(state: tauri::State<'_, ShellState>) -> Result<String, String> {
    let config = CoreConfig::for_workspace(&state.workspace_root);
    let mut child =
        spawn_core(&config, &state.workspace_root).map_err(|error| error.to_string())?;

    let read = wait_for_boot(&mut child, BOOT_TIMEOUT);

    // Reap unconditionally, even when the read failed, so a failed probe cannot
    // leak a process.
    let _ = child.kill();
    let _ = child.wait();

    read.map_err(|error| format!("{error:?}"))
}

/// Describe the long-lived core: its identity, its protocol and its tools.
///
/// The session is started and handshaken on first use, so this is cheap after
/// that first call.
#[tauri::command]
fn core_handshake(state: tauri::State<'_, ShellState>) -> Result<String, String> {
    state.with_core(describe_core)
}

/// List the tools and render a one-line description.
fn describe_core(session: &mut CoreSession) -> Result<String, SessionError> {
    let tools = session.list_tools(HANDSHAKE_TIMEOUT)?;

    let name = session.server_name().unwrap_or("<unnamed>").to_owned();
    let version = session.negotiated_version().unwrap_or("<absent>").to_owned();

    Ok(format!(
        "{name} (protocol {version}) exposes {} tool(s): {}",
        tools.len(),
        tools.join(", ")
    ))
}

/// Invoke a core tool by name, passing `arguments` through unchanged.
///
/// The result is returned the way the core produced it: a tool that fails
/// reports `isError: true` **inside** the result, and the caller decides what
/// that means. Only a broken exchange becomes an `Err`.
#[tauri::command]
fn call_core_tool(
    state: tauri::State<'_, ShellState>,
    tool: String,
    arguments: Value,
) -> Result<Value, String> {
    state.with_core(move |session| session.call_tool(&tool, arguments, TOOL_TIMEOUT))
}

fn main() {
    let workspace_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    tauri::Builder::default()
        .manage(ShellState::new(workspace_root))
        .invoke_handler(tauri::generate_handler![
            shell_info,
            core_boot_probe,
            core_handshake,
            call_core_tool
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the NexusAgent Studio shell");
}
