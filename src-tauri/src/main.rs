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

/// Identity of the running shell.
///
/// This is the first IPC command, and it exists to prove the
/// webview -> Rust channel works before any real work moves across it.
#[tauri::command]
fn shell_info() -> String {
    format!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![shell_info])
        .run(tauri::generate_context!())
        .expect("failed to run the NexusAgent Studio shell");
}
