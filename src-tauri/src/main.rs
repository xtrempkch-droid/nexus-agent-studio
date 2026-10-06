//! Tauri shell for NexusAgent Studio.
//!
//! This is the desktop **host**: it owns the window and the webview, and it is
//! the only layer allowed to touch the operating system. The editor core is the
//! headless TypeScript package in `common/`; nothing here reimplements it.
//!
//! The shell owns one **long-lived** core session — started lazily by
//! `ShellState::with_core`, restarted if the process died — and exposes it to the
//! webview through a small command surface: `shell_info`, `workspace_info`,
//! `core_boot_probe`, `core_handshake`, `call_core_tool`, `set_workspace`,
//! `pick_workspace` and `pick_file`.
//!
//! Two roots are kept deliberately separate: `app_root` is where the bundle
//! lives and the core is found, `workspace_root` is the project the core edits
//! and becomes the child process's working directory. The latter is mutable at
//! runtime — `set_workspace` / `pick_workspace` re-point the editor at another
//! directory by switching the stored path and restarting the core lazily.
//!
//! The layers are split so each can be tested without a window: process plumbing
//! lives in `bridge`, the MCP protocol in `mcp`, and this file only wires them to
//! Tauri.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod mcp;

use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use bridge::{spawn_core, wait_for_boot, CoreConfig};
use mcp::{CoreSession, SessionError};
use serde_json::Value;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};

/// How long the shell waits for the core to announce itself.
const BOOT_TIMEOUT: Duration = Duration::from_secs(15);

/// How long each step of the MCP handshake may take.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);

/// State shared with the commands.
struct ShellState {
    /// Where the bundle lives: `dist/core.mjs` and `runtime/node` resolve from
    /// here. Decided once at startup and never taken from the webview.
    app_root: PathBuf,
    /// The directory the core is pointed at — what the editor actually opens.
    ///
    /// Kept apart from `app_root` on purpose. The core reads its workspace from
    /// its own working directory, so giving both the same value would pin the
    /// editor to whatever directory the app happened to be launched from. Unlike
    /// `app_root`, this is mutable at runtime: the user can open another project
    /// through the native folder picker, and `switch_workspace` updates it.
    workspace_root: Mutex<PathBuf>,
    /// The single core session, started on first use and reused after that.
    ///
    /// The mutex is not only about thread safety: stdio is one
    /// request/response channel, so calls have to be serialised regardless. The
    /// honest cost is that a slow tool blocks the others, which is why a request
    /// queue belongs on the to-do list rather than in this slice.
    core: Mutex<Option<CoreSession>>,
    /// Outbound channel for server-to-client notifications (agent stream
    /// deltas). Every core session is handed a clone, and a forwarder thread
    /// drains the one receiver into Tauri events for the webview. The reader
    /// threads do the sending, so streaming never contends with the request lock.
    notification_tx: mpsc::Sender<Value>,
}

impl ShellState {
    fn new(app_root: PathBuf, workspace_root: PathBuf, notification_tx: mpsc::Sender<Value>) -> Self {
        Self {
            app_root,
            workspace_root: Mutex::new(workspace_root),
            core: Mutex::new(None),
            notification_tx,
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
            let workspace = self
                .workspace_root
                .lock()
                .map_err(|_| "the workspace lock was poisoned".to_string())?;
            *guard = Some(self.start_core(&workspace)?);
        }

        let session = guard
            .as_mut()
            .ok_or_else(|| "the core session is unavailable".to_string())?;

        use_core(session).map_err(|error| error.to_string())
    }

    /// Spawn a core and complete the legacy handshake on it.
    ///
    /// The core binary is located through `app_root`, but the process runs with
    /// `workspace_root` as its working directory — that is how the core decides
    /// which project to serve. Every session is wired to the notification
    /// channel, so its reader thread streams deltas back while a call is in
    /// flight.
    fn start_core(&self, workspace_root: &Path) -> Result<CoreSession, String> {
        let config = CoreConfig::for_app_root(&self.app_root);
        let child = spawn_core(&config, workspace_root).map_err(|error| error.to_string())?;
        let mut session = CoreSession::start_with_notifications(child, Some(self.notification_tx.clone()))
            .map_err(|error| error.to_string())?;

        if let Err(error) = session.initialize(HANDSHAKE_TIMEOUT) {
            // Never leak a core that failed to handshake.
            let _ = session.shutdown(Duration::from_secs(5));
            return Err(error.to_string());
        }

        Ok(session)
    }

    /// Point the editor at a new workspace directory and stop the running core.
    ///
    /// The path is canonicalised so the label and every file tool agree on one
    /// spelling, and the existing core is shut down rather than left pointed at
    /// the old directory — the next use lazily starts a fresh one there. Locks
    /// are taken one at a time, never nested, so there is no ordering to deadlock.
    fn switch_workspace(&self, path: PathBuf) -> Result<String, String> {
        let canonical = path
            .canonicalize()
            .map_err(|error| format!("pasta inválida: {error}"))?;
        if !canonical.is_dir() {
            return Err(format!("não é um diretório: {}", canonical.display()));
        }

        let mut core = self
            .core
            .lock()
            .map_err(|_| "the core session lock was poisoned".to_string())?;
        if let Some(session) = core.take() {
            let _ = session.shutdown(Duration::from_secs(5));
        }
        drop(core);

        let mut workspace = self
            .workspace_root
            .lock()
            .map_err(|_| "the workspace lock was poisoned".to_string())?;
        *workspace = canonical.clone();

        Ok(canonical.display().to_string())
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
async fn core_boot_probe(app: tauri::AppHandle) -> Result<String, String> {
    // Blocking work goes on the blocking pool: see `call_core_tool` for why the
    // main thread must stay free.
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ShellState>();
        let config = CoreConfig::for_app_root(&state.app_root);
        let workspace = state
            .workspace_root
            .lock()
            .map_err(|_| "the workspace lock was poisoned".to_string())?;
        let mut child = spawn_core(&config, &workspace).map_err(|error| error.to_string())?;

        let read = wait_for_boot(&mut child, BOOT_TIMEOUT);

        // Reap unconditionally, even when the read failed, so a failed probe
        // cannot leak a process.
        let _ = child.kill();
        let _ = child.wait();

        read.map_err(|error| format!("{error:?}"))
    })
    .await
    .map_err(|error| format!("o probe do core falhou: {error}"))?
}

/// Describe the long-lived core: its identity, its protocol and its tools.
///
/// The session is started and handshaken on first use, so this is cheap after
/// that first call.
#[tauri::command]
async fn core_handshake(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ShellState>();
        state.with_core(describe_core)
    })
    .await
    .map_err(|error| format!("o handshake do core falhou: {error}"))?
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
///
/// This is deliberately `async` + `spawn_blocking`. A synchronous command runs
/// on the **main thread**, and `ask_agent` holds the call open for as long as the
/// model takes — minutes on a slow local model. Blocking the main thread freezes
/// the WebKitGTK window, which the desktop environment then labels "not
/// responding". Moving the blocking stdio work off the main thread is the fix;
/// the longer timeout makes the wait long, and this makes a long wait harmless.
///
/// `timeout_seconds` is the webview's setting for how long a model turn may take
/// (Tauri renames arguments to camelCase, so it arrives as `timeoutSeconds`). It
/// is optional: without it [`mcp::tool_timeout`] applies its documented default,
/// which keeps every existing caller working and keeps the clamp in one place.
#[tauri::command]
async fn call_core_tool(
    app: tauri::AppHandle,
    tool: String,
    arguments: Value,
    timeout_seconds: Option<u64>,
) -> Result<Value, String> {
    let timeout = mcp::tool_timeout(timeout_seconds);
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ShellState>();
        state.with_core(move |session| session.call_tool(&tool, arguments, timeout))
    })
    .await
    .map_err(|error| format!("a chamada ao core falhou: {error}"))?
}

/// The directory the core is editing.
///
/// The header used to show a hardcoded `workspace / my-python-project` label
/// while the editor looked somewhere else entirely, so there was no way to tell
/// a wrong workspace from an empty one. This reports the real path instead.
#[tauri::command]
fn workspace_info(state: tauri::State<'_, ShellState>) -> Result<String, String> {
    let workspace = state
        .workspace_root
        .lock()
        .map_err(|_| "the workspace lock was poisoned".to_string())?;
    Ok(workspace.display().to_string())
}

/// Point the editor at an explicit workspace directory chosen by the webview.
///
/// This is the text-input fallback to the native picker: the path still goes
/// through `switch_workspace`, so it is canonicalised and checked to be a real
/// directory before anything changes.
#[tauri::command]
async fn set_workspace(app: tauri::AppHandle, path: String) -> Result<String, String> {
    // Switching workspaces shuts the old core down (up to five seconds), so it
    // belongs on the blocking pool like the other core calls.
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ShellState>();
        state.switch_workspace(PathBuf::from(path))
    })
    .await
    .map_err(|error| format!("a troca de pasta falhou: {error}"))?
}

/// Open the native folder picker and, if the user chooses a folder, switch the
/// editor to it. Resolves to the new (canonicalised) workspace path, or `None`
/// when the dialog was cancelled.
#[tauri::command]
async fn pick_workspace(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (sender, receiver) = mpsc::channel::<Option<FilePath>>();

    app.dialog()
        .file()
        .set_title("Escolha o projeto")
        .pick_folder(move |folder_path| {
            let _ = sender.send(folder_path);
        });

    // `pick_folder` invokes its callback on the main thread; `recv` blocks a
    // runtime worker instead, so the dialog's event loop stays free to run.
    let Some(file_path) = receiver.recv().ok().flatten() else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|error| format!("caminho inválido: {error}"))?;

    let state = app.state::<ShellState>();
    Ok(Some(state.switch_workspace(path)?))
}

/// Open the native **file** picker and switch the editor to the file's folder.
///
/// The editor edits a whole project directory, not a loose file, so choosing a
/// file re-points the workspace at its parent and hands back the file name (which
/// is already workspace-relative). This is what makes "open a file" possible
/// without inventing a second, workspace-less editing mode.
///
/// Resolves to `(workspace, file)` or `None` when the dialog was cancelled.
#[tauri::command]
async fn pick_file(app: tauri::AppHandle) -> Result<Option<(String, String)>, String> {
    let (sender, receiver) = mpsc::channel::<Option<FilePath>>();

    app.dialog()
        .file()
        .set_title("Abrir arquivo")
        .pick_file(move |file_path| {
            let _ = sender.send(file_path);
        });

    let Some(file_path) = receiver.recv().ok().flatten() else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|error| format!("caminho inválido: {error}"))?;
    let parent = path
        .parent()
        .ok_or_else(|| "o arquivo não tem pasta pai".to_string())?
        .to_path_buf();
    let name = path
        .file_name()
        .ok_or_else(|| "nome de arquivo inválido".to_string())?
        .to_string_lossy()
        .into_owned();

    let state = app.state::<ShellState>();
    let workspace = state.switch_workspace(parent)?;
    Ok(Some((workspace, name)))
}

fn main() {
    let app_root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let workspace_root = workspace_root_from_environment().unwrap_or_else(|| app_root.clone());

    // One channel for the whole app: core reader threads push notifications here,
    // and the forwarder below drains the single receiver into Tauri events. The
    // receiver lives for the process lifetime, so a restarted core simply reuses
    // the same sink.
    let (notification_tx, notification_rx) = mpsc::channel::<Value>();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ShellState::new(app_root, workspace_root, notification_tx))
        .invoke_handler(tauri::generate_handler![
            shell_info,
            workspace_info,
            core_boot_probe,
            core_handshake,
            call_core_tool,
            set_workspace,
            pick_workspace,
            pick_file
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for notification in notification_rx {
                    // Only the agent stream is webview-facing today; a future
                    // spec notification would be ignored rather than misrouted.
                    if notification.get("method").and_then(Value::as_str)
                        == Some("notifications/agent/stream")
                    {
                        let payload = notification
                            .get("params")
                            .cloned()
                            .unwrap_or_else(|| Value::Null);
                        let _ = handle.emit("agent-stream", &payload);
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run the NexusAgent Studio shell");
}

/// The workspace the core should edit, from `NEXUS_WORKSPACE`.
///
/// An environment variable rather than an argument because `RUN.sh` is what
/// sets it before the process starts; the webview is never asked, since it
/// cannot be trusted to name a filesystem path. Falling back to the launch
/// directory keeps development working, where the repository is both the app
/// root and the project being edited.
fn workspace_root_from_environment() -> Option<PathBuf> {
    let value = std::env::var("NEXUS_WORKSPACE").ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}
