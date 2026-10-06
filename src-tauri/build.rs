//! Build script required by Tauri.
//!
//! `tauri_build::build()` is what reads `tauri.conf.json`, validates it and
//! generates the platform metadata (capabilities, permissions, assets). If the
//! config is wrong, this is where the build fails.

fn main() {
    tauri_build::build()
}
