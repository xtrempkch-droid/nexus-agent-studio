//! Tauri shell for NexusAgent Studio.
//!
//! This is the desktop **host**: it owns the window and the webview, and it is
//! the only layer allowed to touch the operating system. The editor core is the
//! headless TypeScript package in `common/`; nothing here reimplements it.
//!
//! The shell owns one **long-lived** core session. It does not hold it directly:
//! [`worker::CoreWorker`] owns it on a dedicated thread and every request queues
//! behind that thread in submission order. The command surface is `shell_info`,
//! `workspace_info`, `core_boot_probe`, `core_handshake`, `call_core_tool`,
//! `set_workspace`, `pick_workspace` and `pick_file`.
//!
//! The queue replaced a `Mutex<Option<CoreSession>>` that every command held for
//! the whole call. Serialising the channel was always required — stdio is one
//! pipe — but holding a lock while waiting was not, and it meant a slow
//! `ask_agent` turn blocked every other tool for as long as the model took. See
//! `worker` for what changed and, just as importantly, for what did not.
//!
//! Two roots are kept deliberately separate: `app_root` is where the bundle
//! lives and the core is found, `workspace_root` is the project the core edits
//! and becomes the child process's working directory. The latter is mutable at
//! runtime — `set_workspace` / `pick_workspace` re-point the editor at another
//! directory by switching the stored path and restarting the core lazily.
//!
//! The layers are split so each can be tested without a window: process plumbing
//! lives in `bridge`, the MCP protocol in `mcp`, the request queue in `worker`,
//! and this file only wires them to Tauri.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod mcp;
mod worker;

use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use bridge::{spawn_core, wait_for_boot, CoreConfig};
use serde_json::Value;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};
use worker::{CoreDescription, CoreWorker};

/// How long the shell waits for the core to announce itself.
const BOOT_TIMEOUT: Duration = Duration::from_secs(15);

/// Budget for `core_handshake`.
///
/// Generous on purpose: the first call also **starts** the core, so it pays for a
/// process spawn plus a handshake (bounded at 20 s in `worker`) before the listing
/// it was asked for.
const DESCRIBE_BUDGET: Duration = Duration::from_secs(60);

/// Budget for re-pointing the editor at another directory.
const SWITCH_BUDGET: Duration = Duration::from_secs(30);

/// State shared with the commands.
struct ShellState {
    /// Where the bundle lives: `dist/core.mjs` and `runtime/node` resolve from
    /// here. Decided once at startup and never taken from the webview.
    app_root: PathBuf,
    /// The request queue in front of the single core session.
    ///
    /// The workspace lives inside it rather than here, and deliberately so: the
    /// core reads its workspace from its own working directory, and the worker is
    /// what starts that process. One owner means one value to keep in step — a
    /// second copy here would be a second thing that can drift, and drift means the
    /// header names a project the core is not serving.
    ///
    /// Kept apart from `app_root` on purpose: giving both the same value would pin
    /// the editor to whatever directory the app was launched from.
    worker: CoreWorker,
}

impl ShellState {
    /// Re-point the editor at a new workspace directory.
    fn switch_workspace(&self, path: PathBuf) -> Result<String, String> {
        self.worker.switch_workspace(path, Some(SWITCH_BUDGET))
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
        let workspace = state.worker.workspace();
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
        let description = state.worker.describe(Some(DESCRIBE_BUDGET))?;
        Ok(render_description(&description))
    })
    .await
    .map_err(|error| format!("o handshake do core falhou: {error}"))?
}

/// Render a core description as one line.
fn render_description(description: &CoreDescription) -> String {
    let name = description.server_name.as_deref().unwrap_or("<unnamed>");
    let version = description.negotiated_version.as_deref().unwrap_or("<absent>");

    format!(
        "{name} (protocol {version}) exposes {} tool(s): {}",
        description.tools.len(),
        description.tools.join(", ")
    )
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
/// The wait now happens on this thread's own reply channel rather than on a mutex
/// held across the whole call, so a slow turn no longer stops other requests from
/// being submitted and handled in order (see `worker`).
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
    let budget = mcp::tool_timeout(timeout_seconds);
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ShellState>();
        state.worker.call_tool(&tool, arguments, budget)
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
    // Read straight from the shared cell, never through the queue: this has to stay
    // instant while a long turn is in flight, or the header appears to hang.
    Ok(state.worker.workspace().display().to_string())
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

    // The switch stops the old core, so it is blocking work — same rule as
    // `set_workspace`. Calling it inline would stall a runtime worker.
    let switch_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = switch_handle.state::<ShellState>();
        state.switch_workspace(path)
    })
    .await
    .map_err(|error| format!("a troca de pasta falhou: {error}"))?
    .map(Some)
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

    let switch_handle = app.clone();
    let workspace = tauri::async_runtime::spawn_blocking(move || {
        let state = switch_handle.state::<ShellState>();
        state.switch_workspace(parent)
    })
    .await
    .map_err(|error| format!("a troca de pasta falhou: {error}"))??;

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

    // One value for the workspace, owned by the worker: it writes the path when a
    // switch is applied, and `workspace_info` reads it through the worker without
    // queueing behind a turn.
    let workspace = Arc::new(Mutex::new(workspace_root));

    // The worker owns the core session. It starts the core lazily on the first job
    // that needs one, so an app that is opened and left alone pays for nothing.
    let core_worker = CoreWorker::spawn(
        worker::core_factory(app_root.clone(), Some(notification_tx)),
        workspace,
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ShellState {
            app_root,
            worker: core_worker,
        })
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
