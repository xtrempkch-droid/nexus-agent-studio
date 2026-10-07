//! Compiles and tests the Tauri-free shell modules **without** a window.
//!
//! ## Why this exists
//!
//! The full `src-tauri` crate cannot be built on a machine without the GTK and
//! WebKitGTK development packages — that is a system-level install, and the
//! machine that prompted this file has no passwordless `sudo`. So the two modules
//! that were written to be Tauri-free (`bridge.rs`, `mcp.rs`) had no local test
//! loop at all: a change to them could only be checked after a push.
//!
//! This crate restores that loop. It pulls in the **real** source files by
//! relative path, so there is no copy to drift:
//!
//! ```text
//! sh -c 'cd src-tauri/harness && cargo test'
//! ```
//!
//! ## What it does and does not prove
//!
//! It compiles and runs the tests inside `bridge.rs` and `mcp.rs`, which is where
//! the process plumbing and the MCP client live. It does **not** compile
//! `main.rs` — the Tauri command layer — because that needs the system libraries.
//! A change that touches `main.rs` still needs CI for the Rust half; a change
//! confined to these two modules can be verified here.
//!
//! ## Why `#[path]` and not a copy
//!
//! A duplicated copy would be worse than no harness: it would pass while the real
//! file was broken. `#[path]` is relative to this file, so it stays correct
//! wherever the repository is checked out.

#[path = "../../src/bridge.rs"]
pub mod bridge;

#[path = "../../src/mcp.rs"]
pub mod mcp;
