//! Sidecar bridge to the headless TypeScript core.
//!
//! The desktop shell does not reimplement the editor core; it **spawns** it. The
//! core is a Node process (`dist/core.mjs`) that speaks MCP over stdio, so the
//! Rust side only has to start that process and talk JSON-RPC on its
//! stdin/stdout.
//!
//! Everything here is deliberately Tauri-free. Keeping the process plumbing in a
//! plain module means it can be unit-tested without an event loop, a window or a
//! display, which matters because the CI runner has none of those. `main.rs`
//! stays a thin command wrapper on top of this.

use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// Where the core lives and which runtime executes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreConfig {
    /// The runtime that executes the core. Left as a bare name by default so the
    /// operating system resolves it from `PATH`, which is what someone with Node
    /// installed expects. Point it at an absolute path to pin a bundled runtime.
    pub runtime: PathBuf,
    /// Path to the bundled core entry point.
    pub entry: PathBuf,
}

impl CoreConfig {
    /// Config for the **application root**: the directory the bundle lives in,
    /// which is where `dist/core.mjs` and `runtime/node` are.
    ///
    /// This is deliberately *not* the workspace. The two were one value until
    /// the cost of that became visible: the core derives its workspace from its
    /// own working directory, so conflating them meant the editor was pointed at
    /// whatever directory the app happened to be launched from, with no way to
    /// open an actual project. `spawn_core` takes the workspace separately.
    ///
    /// The bundled runtime is a plain relative lookup, with no `.exe` suffix
    /// probing: the bundle is built per platform, and guessing an executable
    /// name from the host would be a second, weaker copy of information the
    /// bundle already carries.
    pub fn for_app_root(app_root: &Path) -> Self {
        let bundled = app_root.join("runtime").join("node");
        let runtime = if bundled.is_file() {
            bundled
        } else {
            PathBuf::from("node")
        };
        Self {
            runtime,
            entry: app_root.join("dist").join("core.mjs"),
        }
    }
}

/// Build — but do not run — the command that starts the core as a stdio MCP
/// server.
///
/// `stdout` is piped because it is the JSON-RPC channel: letting it reach the
/// terminal would corrupt the protocol. `stderr` is piped rather than inherited
/// so the shell decides what to do with the core's diagnostics instead of them
/// landing on the shell's own stderr unannounced.
pub fn core_command(config: &CoreConfig, workspace_root: &Path) -> Command {
    let mut command = Command::new(&config.runtime);
    command
        .arg(&config.entry)
        .current_dir(workspace_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

/// Spawn the core as a child process. The caller owns the child and must reap it.
pub fn spawn_core(config: &CoreConfig, workspace_root: &Path) -> io::Result<Child> {
    core_command(config, workspace_root).spawn()
}

/// Why the core did not announce itself in time.
#[derive(Debug)]
pub enum BootError {
    /// Nothing arrived on stderr before the deadline.
    TimedOut,
    /// stderr was not piped, so there is nothing to read.
    NoStderr,
    /// The core exited before writing its startup line.
    ExitedEarly,
}

/// Wait until the core writes a line to stderr, or the deadline passes.
///
/// The core prints a startup line to stderr (`[nexus] serving N tools over
/// stdio`) before it starts serving. Waiting for that line is the cheapest
/// honest way to know the sidecar really came up: no protocol handling, no
/// handshake, just evidence that the process is alive and past its bootstrap.
pub fn wait_for_boot(child: &mut Child, timeout: Duration) -> Result<String, BootError> {
    let stderr = child.stderr.take().ok_or(BootError::NoStderr)?;
    let (sender, receiver) = mpsc::channel::<String>();

    // A dedicated reader thread is required, not optional: stderr is a pipe and
    // the core blocks once the pipe buffer fills, so somebody must always drain
    // it. `recv_timeout` on the main thread supplies the deadline.
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(text) => {
                    if sender.send(text).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    match receiver.recv_timeout(timeout) {
        Ok(line) => Ok(line),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(BootError::TimedOut),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(BootError::ExitedEarly),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    fn config() -> CoreConfig {
        CoreConfig {
            runtime: PathBuf::from("node"),
            entry: PathBuf::from("/ws/dist/core.mjs"),
        }
    }

    #[test]
    fn for_app_root_places_the_entry_under_dist() {
        let built = CoreConfig::for_app_root(Path::new("/ws"));
        assert_eq!(built.runtime, PathBuf::from("node"));
        assert_eq!(built.entry, PathBuf::from("/ws/dist/core.mjs"));
    }

    /// The regression test for the bug this whole split exists to fix: the
    /// directory the app was launched from must not decide what gets edited.
    #[test]
    fn core_command_takes_the_core_from_the_app_root_but_runs_in_the_workspace() {
        let config = CoreConfig::for_app_root(Path::new("/bundle"));
        let command = core_command(&config, Path::new("/home/dev/project"));

        assert_eq!(command.get_current_dir(), Some(Path::new("/home/dev/project")));
        let args: Vec<&OsStr> = command.get_args().collect();
        assert_eq!(args, vec![OsStr::new("/bundle/dist/core.mjs")]);
    }

    #[test]
    fn core_command_invokes_the_runtime_with_only_the_entry() {
        let command = core_command(&config(), Path::new("/ws"));
        assert_eq!(command.get_program(), OsStr::new("node"));
        let args: Vec<&OsStr> = command.get_args().collect();
        assert_eq!(args, vec![OsStr::new("/ws/dist/core.mjs")]);
    }

    #[test]
    fn core_command_runs_from_the_workspace_root() {
        let command = core_command(&config(), Path::new("/ws"));
        assert_eq!(command.get_current_dir(), Some(Path::new("/ws")));
    }

    /// Proves stdin and stderr are both wired to pipes by driving a real child:
    /// the script reads one line from stdin and echoes it to stderr.
    ///
    /// This has to be behavioural. `Command` exposes `get_program`, `get_args`
    /// and `get_current_dir`, but **no** accessor for the configured streams, so
    /// there is no way to assert on them directly.
    #[cfg(unix)]
    #[test]
    fn spawn_core_pipes_stdin_and_stderr() {
        use std::io::Write;

        let dir = std::env::temp_dir().join("nexus-agent-studio-bridge-stdin-test");
        std::fs::create_dir_all(&dir).expect("failed to create the temp dir");
        let script = dir.join("echo-to-stderr.sh");
        std::fs::write(&script, "read line\nprintf '%s\\n' \"$line\" >&2\n")
            .expect("failed to write the script");

        let config = CoreConfig {
            runtime: PathBuf::from("sh"),
            entry: script,
        };

        let mut child = spawn_core(&config, &dir).expect("failed to spawn sh");

        // Taking the handle and dropping it closes the pipe, which is what lets
        // the child's `read` return at all.
        child
            .stdin
            .take()
            .expect("stdin should be piped")
            .write_all(b"ping\n")
            .expect("failed to write to the child stdin");

        let line = wait_for_boot(&mut child, Duration::from_secs(10))
            .expect("stderr should be piped and readable");
        assert_eq!(line, "ping");

        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Behavioural proof that stdout really is captured, rather than an
    /// assertion about how the standard library spells "piped". `printf hello`
    /// writes to stdout with no shell and no Node involved.
    #[cfg(unix)]
    #[test]
    fn spawn_core_captures_the_child_stdout() {
        use std::io::Read;

        let config = CoreConfig {
            runtime: PathBuf::from("printf"),
            entry: PathBuf::from("hello"),
        };

        let mut child = spawn_core(&config, Path::new("/")).expect("failed to spawn printf");
        let mut captured = String::new();
        child
            .stdout
            .take()
            .expect("stdout should be piped")
            .read_to_string(&mut captured)
            .expect("failed to read the child stdout");

        assert_eq!(captured, "hello");

        let _ = child.wait();
    }

    #[cfg(unix)]
    #[test]
    fn wait_for_boot_returns_the_first_stderr_line() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("printf 'booted\\n' >&2")
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn sh");

        let line = wait_for_boot(&mut child, Duration::from_secs(10)).expect("expected a boot line");
        assert_eq!(line, "booted");

        let _ = child.kill();
        let _ = child.wait();
    }

    #[cfg(unix)]
    #[test]
    fn wait_for_boot_gives_up_instead_of_hanging() {
        let mut child = Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn sleep");

        let error = wait_for_boot(&mut child, Duration::from_millis(250))
            .expect_err("a silent process must not satisfy the boot wait");
        assert!(matches!(error, BootError::TimedOut), "got {error:?}");

        let _ = child.kill();
        let _ = child.wait();
    }

    #[cfg(unix)]
    #[test]
    fn wait_for_boot_reports_an_early_exit() {
        // Closes stderr immediately without writing anything.
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("exec 2>&-")
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn sh");

        let error = wait_for_boot(&mut child, Duration::from_secs(10))
            .expect_err("a process that closed stderr must not look like a boot");

        assert!(
            matches!(error, BootError::ExitedEarly | BootError::TimedOut),
            "got {error:?}"
        );

        let _ = child.kill();
        let _ = child.wait();
    }

    /// The packaged bundle carries its own runtime so someone who has never
    /// installed Node can still run the app. The path is relative to the
    /// workspace root on purpose: that is the directory the user runs from.
    #[test]
    fn for_app_root_prefers_the_bundled_runtime_when_the_bundle_ships_one() {
        let dir = std::env::temp_dir().join("nexus-agent-studio-bundled-runtime-test");
        let runtime = dir.join("runtime").join("node");
        std::fs::create_dir_all(runtime.parent().expect("runtime dir has a parent"))
            .expect("failed to create the temp dir");
        std::fs::write(&runtime, b"#!/bin/sh\n").expect("failed to write the fake runtime");

        let config = CoreConfig::for_app_root(&dir);
        assert_eq!(config.runtime, runtime);
        assert_eq!(config.entry, dir.join("dist").join("core.mjs"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The fallback has to survive the arrival of the bundled runtime, otherwise
    /// development on a machine that happens to have a stray `runtime/node`
    /// would silently run the wrong Node.
    #[test]
    fn for_app_root_falls_back_to_path_node_without_a_bundle() {
        let dir = std::env::temp_dir().join("nexus-agent-studio-no-bundle-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("failed to create the temp dir");

        let config = CoreConfig::for_app_root(&dir);
        assert_eq!(config.runtime, PathBuf::from("node"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
