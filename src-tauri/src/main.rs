//! Tauri shell for NexusAgent Studio.
//!
//! This is the desktop **host**: it owns the window and the webview, and it is
//! the only layer allowed to touch the operating system. The editor core is the
//! headless TypeScript package in `common/`; nothing here reimplements it.
//!
//! Deliberately minimal for now. The point of this file is to give `cargo check`
//! a real `tauri::generate_context!()` to expand, which is what proves the
//! configuration, the capabilities and the embedded `frontendDist` are actually
//! valid. The IPC bridge that will spawn the core over stdio comes next; adding
//! commands before the shell is known to compile would just add unknowns.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod mcp;

use std::path::PathBuf;
use std::time::Duration;

use bridge::{spawn_core, wait_for_boot, CoreConfig};
use mcp::{CoreSession, SessionError};
use serde_json::Value;

/// How long the shell waits for the core to announce itself.
const BOOT_TIMEOUT: Duration = Duration::from_secs(15);

/// How long each step of the MCP handshake may take.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);

/// State shared with the commands.
struct ShellState {
    /// The directory the shell treats as the project root. Resolved once at
    /// startup, never taken from the webview: a webview cannot be trusted to
    /// name a filesystem path.
    workspace_root: PathBuf,
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

/// Run the legacy MCP handshake against a freshly started core and describe it.
///
/// This is the first command that actually *talks* to the core rather than only
/// checking that it starts. It spawns a core per call, which is honest for a
/// probe and deliberately not the final shape: a long-lived session, and the
/// modern protocol era, belong to a later slice.
#[tauri::command]
fn core_handshake(state: tauri::State<'_, ShellState>) -> Result<String, String> {
    let config = CoreConfig::for_workspace(&state.workspace_root);
    let child = spawn_core(&config, &state.workspace_root).map_err(|error| error.to_string())?;
    let mut session = CoreSession::start(child).map_err(|error| error.to_string())?;

    let described = describe_core(&mut session);

    // Reap unconditionally, so a failed handshake cannot leave a core running.
    let _ = session.shutdown(Duration::from_secs(5));

    described.map_err(|error| error.to_string())
}

/// Handshake, list the tools, and render a one-line description.
fn describe_core(session: &mut CoreSession) -> Result<String, SessionError> {
    let initialized = session.initialize(HANDSHAKE_TIMEOUT)?;
    let tools = session.list_tools(HANDSHAKE_TIMEOUT)?;

    let name = initialized
        .get("serverInfo")
        .and_then(|info| info.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("<unnamed>");
    let version = session.negotiated_version().unwrap_or("<absent>");

    Ok(format!(
        "{name} (protocol {version}) exposes {} tool(s): {}",
        tools.len(),
        tools.join(", ")
    ))
}

fn main() {
    let workspace_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    tauri::Builder::default()
        .manage(ShellState { workspace_root })
        .invoke_handler(tauri::generate_handler![
            shell_info,
            core_boot_probe,
            core_handshake
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the NexusAgent Studio shell");
}
