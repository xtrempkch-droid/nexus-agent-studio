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
    /// Config for a workspace root: `node` from `PATH`, and `dist/core.mjs`
    /// inside that root. This mirrors what `npm run start` runs.
    pub fn for_workspace(workspace_root: &Path) -> Self {
        Self {
            runtime: PathBuf::from("node"),
            entry: workspace_root.join("dist").join("core.mjs"),
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
    fn for_workspace_places_the_entry_under_dist() {
        let built = CoreConfig::for_workspace(Path::new("/ws"));
        assert_eq!(built.runtime, PathBuf::from("node"));
        assert_eq!(built.entry, PathBuf::from("/ws/dist/core.mjs"));
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

    /// All three streams must be configured explicitly. Asserting `is_some`
    /// rather than inspecting the `Stdio` value is deliberate: `Stdio` does not
    /// expose which kind it is, and its `Debug` output is an implementation
    /// detail that is not part of any stability guarantee.
    #[test]
    fn core_command_configures_stdin_stdout_and_stderr() {
        let command = core_command(&config(), Path::new("/ws"));
        assert!(command.get_stdin().is_some(), "stdin must be configured");
        assert!(command.get_stdout().is_some(), "stdout must be configured");
        assert!(command.get_stderr().is_some(), "stderr must be configured");
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
}
