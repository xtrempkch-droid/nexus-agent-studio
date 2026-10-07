//! Minimal MCP client over a child process's stdio.
//!
//! This is the sidecar's voice: `bridge.rs` starts the core, this module talks to
//! it. Everything here is Tauri-free for the same reason as the bridge — the
//! tests must run on a runner with no window and no display.
//!
//! ## Which protocol era, and why
//!
//! The 2026-07-28 specification splits peers into two eras. The **modern** era
//! carries per-request metadata in `_meta.io.modelcontextprotocol/*` and has no
//! connection handshake. The **legacy** era opens the connection with an
//! `initialize` request followed by a `notifications/initialized` notification.
//!
//! This client implements the legacy era only, deliberately:
//! the spec requires a `server/discover` probe from clients that support *both*
//! eras, and a legacy-only client is free to go straight to `initialize`. That
//! path is also the one already proven to work against this core — the real
//! client driven from `scripts/smoke-mcp.ts` connects with the SDK's default
//! legacy handshake and lists the ten tools.
//!
//! Speaking the modern flow is a separate slice. When it lands, the
//! `server/discover` probe belongs here, and its rule must be respected: fall
//! back to `initialize` on *any* unrecognised error, never on one specific code.
//!
//! ## Framing
//!
//! The stdio binding is newline-delimited JSON-RPC: one message per line, and a
//! message MUST NOT contain an embedded newline. `serde_json` escapes newlines
//! inside strings, so serialising a single `Value` always yields exactly one
//! line — there is a test asserting that, because the whole transport depends on
//! it.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// Name this shell reports to the core during the handshake.
pub const CLIENT_NAME: &str = "nexus-agent-studio-shell";

/// Version this shell reports to the core during the handshake.
pub const CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Protocol revision requested in the legacy handshake.
///
/// Sent as a request, not a demand: the legacy handshake negotiates, and the
/// value the server actually chose comes back in the response. `CoreSession`
/// exposes that as [`CoreSession::negotiated_version`] rather than assuming this
/// constant wins.
pub const REQUESTED_PROTOCOL_VERSION: &str = "2026-07-28";

/// Ceiling for a single tool call, in seconds, when the webview does not ask for
/// one. Ten minutes is a ceiling for "the model is still thinking", not a target.
pub const DEFAULT_TOOL_TIMEOUT_SECONDS: u64 = 600;

/// Shortest **positive** tool-call timeout, in seconds.
///
/// A few seconds is not a timeout, it is a guaranteed failure: even `tools/list`
/// cannot finish inside it, and the container tools have their own, longer, limit
/// that this one would pre-empt.
const MIN_TOOL_TIMEOUT_SECONDS: u64 = 10;

/// Longest tool-call timeout a caller may ask for, in seconds (24 h).
const MAX_TOOL_TIMEOUT_SECONDS: u64 = 86_400;

/// Turn a caller-supplied timeout into a deadline, or into `None` for "no deadline".
///
/// The webview owns this value because only the user knows how slow their model
/// is: a turn is one `ask_agent` call, and a local model on CPU can need far more
/// than the default while a hosted one needs seconds.
///
/// - `None` means "no preference" and gets [`DEFAULT_TOOL_TIMEOUT_SECONDS`] — it is
///   not "no timeout", because a client that says nothing should still not hang for
///   ever on a wedged core.
/// - `Some(0)` **is** "no timeout": wait as long as it takes. That is a deliberate
///   request from the settings field, which spells it out, and it is the only way to
///   run a task on a slow local model with no ceiling at all.
/// - Any other value is clamped into the usable range: below
///   [`MIN_TOOL_TIMEOUT_SECONDS`] the call is doomed, above the maximum a typo would
///   hold the session (and the UI waiting on it) for ever.
pub fn tool_timeout(requested: Option<u64>) -> Option<Duration> {
    match requested {
        None => Some(Duration::from_secs(DEFAULT_TOOL_TIMEOUT_SECONDS)),
        Some(0) => None,
        Some(seconds) => Some(Duration::from_secs(
            seconds.clamp(MIN_TOOL_TIMEOUT_SECONDS, MAX_TOOL_TIMEOUT_SECONDS),
        )),
    }
}

/// What can go wrong while speaking to the core.
#[derive(Debug)]
pub enum SessionError {
    /// Reading or writing a stream failed.
    Io(std::io::Error),
    /// A message was not valid JSON.
    Json(serde_json::Error),
    /// The exchange broke the protocol, or the server reported an error.
    Protocol(String),
    /// Nothing arrived before the deadline.
    Timeout(String),
    /// A stream the session needs was not piped.
    MissingPipe(&'static str),
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "io: {error}"),
            Self::Json(error) => write!(formatter, "json: {error}"),
            Self::Protocol(message) => write!(formatter, "protocol: {message}"),
            Self::Timeout(message) => write!(formatter, "timeout: {message}"),
            Self::MissingPipe(stream) => write!(formatter, "{stream} was not piped"),
        }
    }
}

impl From<std::io::Error> for SessionError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for SessionError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

/// One MCP conversation with a running core.
pub struct CoreSession {
    child: Child,
    stdin: ChildStdin,
    responses: Receiver<String>,
    stderr_lines: Arc<Mutex<Vec<String>>>,
    last_id: u64,
    server_name: Option<String>,
    negotiated_version: Option<String>,
}

impl CoreSession {
    /// Take over a core process that has already been spawned with piped streams.
    ///
    /// Two reader threads are started, and both are required. `stdout` carries
    /// the protocol, so it must be drained line by line and handed to the caller.
    /// `stderr` is not part of the protocol, but leaving it unread would fill the
    /// pipe buffer and block the child mid-conversation; its lines are collected
    /// only so a failed handshake can show what the core said about itself.
    ///
    /// This convenience entry routes server-to-client notifications nowhere — it
    /// is what the tests use. The shell uses
    /// [`CoreSession::start_with_notifications`] so it can stream them onward.
    pub fn start(child: Child) -> Result<Self, SessionError> {
        Self::start_with_notifications(child, None)
    }

    /// Like [`CoreSession::start`], but forwards every server-to-client
    /// notification (a message with no `id`) to `notification_sink` while it is
    /// being read. Responses still go through the ordinary request/response
    /// channel, so a streaming notification cannot desynchronise a pending call.
    pub fn start_with_notifications(
        mut child: Child,
        notification_sink: Option<Sender<Value>>,
    ) -> Result<Self, SessionError> {
        let stdin = child.stdin.take().ok_or(SessionError::MissingPipe("stdin"))?;
        let stdout = child.stdout.take().ok_or(SessionError::MissingPipe("stdout"))?;
        let stderr = child.stderr.take().ok_or(SessionError::MissingPipe("stderr"))?;

        let responses = spawn_line_reader(stdout, notification_sink);

        let stderr_lines = Arc::new(Mutex::new(Vec::new()));
        let collected = Arc::clone(&stderr_lines);
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                let Ok(text) = line else { break };
                if let Ok(mut guard) = collected.lock() {
                    guard.push(text);
                }
            }
        });

        Ok(Self {
            child,
            stdin,
            responses,
            stderr_lines,
            last_id: 0,
            server_name: None,
            negotiated_version: None,
        })
    }

    /// The name the core reported as its `serverInfo.name`, once handshaken.
    pub fn server_name(&self) -> Option<&str> {
        self.server_name.as_deref()
    }

    /// The protocol revision the core chose during the handshake, if it got that far.
    pub fn negotiated_version(&self) -> Option<&str> {
        self.negotiated_version.as_deref()
    }

    /// Whatever the core has written to `stderr` so far, for diagnostics.
    ///
    /// The spec is explicit that `stderr` output must not be read as an error
    /// signal, so this is only ever used to explain a failure that was already
    /// detected on the protocol channel.
    pub fn stderr_tail(&self) -> Vec<String> {
        self.stderr_lines
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    /// Run the legacy handshake: `initialize`, then `notifications/initialized`.
    ///
    /// Returns the `initialize` result. The notification is sent before this
    /// returns because the spec requires the client to confirm before sending
    /// any further request.
    pub fn initialize(&mut self, timeout: Duration) -> Result<Value, SessionError> {
        let id = self.allocate_id();
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "initialize",
            "params": {
                "protocolVersion": REQUESTED_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": CLIENT_NAME, "version": CLIENT_VERSION },
            },
        }))?;

        let response = self.await_response(id, "initialize", Some(timeout))?;
        let result = unwrap_result(response)?;

        self.negotiated_version = result
            .get("protocolVersion")
            .and_then(Value::as_str)
            .map(str::to_owned);
        self.server_name = result
            .get("serverInfo")
            .and_then(|info| info.get("name"))
            .and_then(Value::as_str)
            .map(str::to_owned);

        self.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))?;

        Ok(result)
    }

    /// Ask the core which tools it exposes, by name.
    pub fn list_tools(&mut self, timeout: Duration) -> Result<Vec<String>, SessionError> {
        let id = self.allocate_id();
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/list",
            "params": {},
        }))?;

        let response = self.await_response(id, "tools/list", Some(timeout))?;
        let result = unwrap_result(response)?;

        let tools = result
            .get("tools")
            .and_then(Value::as_array)
            .ok_or_else(|| SessionError::Protocol(format!("tools/list had no tools array: {result}")))?;

        Ok(tools
            .iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str).map(str::to_owned))
            .collect())
    }

    /// Invoke one tool and hand back its raw `result`.
    ///
    /// The result is returned unshaped on purpose: a tool that fails still
    /// resolves with `isError: true` **inside** the result, which is an ordinary
    /// outcome for the caller to judge. Only protocol failures become `Err` here.
    ///
    /// `timeout` is `Option` because "no deadline" is a real request: a local model
    /// can take longer than any ceiling a person is willing to type, and the user
    /// who sets the agent timeout to zero is asking to wait as long as it takes.
    /// The handshake keeps a fixed deadline on purpose — a core that never answers
    /// `initialize` is broken, not slow.
    pub fn call_tool(
        &mut self,
        name: &str,
        arguments: Value,
        timeout: Option<Duration>,
    ) -> Result<Value, SessionError> {
        let id = self.allocate_id();
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": { "name": name, "arguments": arguments },
        }))?;

        let response = self.await_response(id, "tools/call", timeout)?;
        unwrap_result(response)
    }

    /// Whether the core process is still alive.
    ///
    /// A long-lived session needs this to tell "reusable" from "died since the
    /// last call". The spec says a client SHOULD restart a server that exited
    /// unexpectedly, and that the protocol is stateless, so a dead session is
    /// replaced rather than reported.
    pub fn is_running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Shut the core down the way the spec asks for.
    ///
    /// Closing `stdin` is the portable graceful signal and the spec says servers
    /// SHOULD exit on it, so that is tried first and force is only used if the
    /// child is still alive when the deadline passes.
    pub fn shutdown(mut self, timeout: Duration) -> Result<(), SessionError> {
        drop(self.stdin);

        if wait_for_exit(&mut self.child, timeout)? {
            return Ok(());
        }

        self.child.kill()?;
        self.child.wait()?;
        Ok(())
    }

    fn allocate_id(&mut self) -> u64 {
        self.last_id += 1;
        self.last_id
    }

    /// Write one message as a single line and flush it.
    ///
    /// The flush is not optional: stdio is a pipe, so without it the child may
    /// sit waiting for a message that is still in our buffer.
    fn send(&mut self, message: &Value) -> Result<(), SessionError> {
        let line = serde_json::to_string(message)?;
        self.stdin.write_all(line.as_bytes())?;
        self.stdin.write_all(b"\n")?;
        self.stdin.flush()?;
        Ok(())
    }

    /// Read until the response carrying `id` arrives.
    ///
    /// stdout is a single shared channel, so anything that is not the response we
    /// are waiting for — notifications, or replies to earlier requests — is
    /// skipped rather than treated as a failure.
    /**
     * Wait for one reply.
     *
     * `timeout` is the caller's setting; `None` means "wait indefinitely", which is
     * what the UI asks for when the user sets the agent timeout to zero. Blocking
     * without a deadline still notices a dead core, because the reader thread drops
     * the sender when stdout closes.
     */
    fn await_response(
        &mut self,
        id: u64,
        method: &str,
        timeout: Option<Duration>,
    ) -> Result<Value, SessionError> {
        let mut skipped = 0u32;

        loop {
            let line = match timeout {
                Some(limit) => match self.responses.recv_timeout(limit) {
                    Ok(line) => line,
                    Err(RecvTimeoutError::Timeout) => {
                        return Err(SessionError::Timeout(format!(
                            "no reply to {method} (id {id}) within {limit:?} after skipping {skipped} message(s)"
                        )))
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        return Err(SessionError::Protocol(format!(
                            "the core closed stdout before replying to {method} (id {id})"
                        )))
                    }
                },
                None => match self.responses.recv() {
                    Ok(line) => line,
                    Err(_) => {
                        return Err(SessionError::Protocol(format!(
                            "the core closed stdout before replying to {method} (id {id})"
                        )))
                    }
                },
            };

            let message: Value = serde_json::from_str(&line)?;

            if message.get("id").and_then(Value::as_u64) == Some(id) {
                return Ok(message);
            }

            skipped += 1;
        }
    }
}

/// Surface a JSON-RPC error, or hand back the `result` object.
///
/// Errors are returned rather than ignored so that a rejected handshake says why.
fn unwrap_result(response: Value) -> Result<Value, SessionError> {
    if let Some(error) = response.get("error") {
        return Err(SessionError::Protocol(format!("the core returned an error: {error}")));
    }

    response
        .get("result")
        .cloned()
        .ok_or_else(|| SessionError::Protocol(format!("response carried neither result nor error: {response}")))
}

/// Poll a child until it exits or the deadline passes. Returns whether it exited.
fn wait_for_exit(child: &mut Child, timeout: Duration) -> std::io::Result<bool> {
    let deadline = Instant::now() + timeout;

    loop {
        if child.try_wait()?.is_some() {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(20));
    }
}

/// A JSON-RPC message is a server-to-client **notification** when it has no `id`.
///
/// Responses (and requests) always carry an `id`; only notifications omit it.
/// The check is on key presence, so an error response with `"id": null` is still
/// recognised as a response rather than misrouted.
fn is_notification(line: &str) -> bool {
    match serde_json::from_str::<Value>(line) {
        Ok(message) => message.get("id").is_none(),
        Err(_) => false,
    }
}

/// Drain a stream into a channel of lines, one per line.
///
/// When a `notification_sink` is given, messages without an `id` are routed to it
/// instead of the response channel, so the caller can forward them (for example
/// to the webview) without ever competing with a pending request for the line.
fn spawn_line_reader<R: Read + Send + 'static>(
    reader: R,
    notification_sink: Option<Sender<Value>>,
) -> Receiver<String> {
    let (sender, receiver) = mpsc::channel();

    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            let Ok(text) = line else { break };

            if let Some(sink) = &notification_sink {
                if is_notification(&text) {
                    if let Ok(message) = serde_json::from_str::<Value>(&text) {
                        if sink.send(message).is_err() {
                            break;
                        }
                    }
                    continue;
                }
            }

            if sender.send(text).is_err() {
                break;
            }
        }
    });

    receiver
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge::{spawn_core, CoreConfig};
    use std::path::Path;

    /// How long the end-to-end test allows for each protocol step.
    const STEP_TIMEOUT: Duration = Duration::from_secs(20);

    #[test]
    fn the_tool_timeout_defaults_and_clamps() {
        // The webview supplies this value from a settings field a human typed, so
        // every case here is reachable: too small and even `tools/list` cannot
        // finish, too large and a wedged core holds the session for ever, and zero
        // is the explicit request to wait with no deadline at all.
        let seconds = |requested| tool_timeout(requested).map(|limit| limit.as_secs());

        // Silence means "no preference": the default deadline, not "no deadline".
        assert_eq!(seconds(None), Some(DEFAULT_TOOL_TIMEOUT_SECONDS));
        assert_eq!(seconds(Some(600)), Some(600));
        // Zero is the one value that means "wait as long as it takes".
        assert_eq!(seconds(Some(0)), None);
        // Both ends are clamped into the usable range.
        assert_eq!(seconds(Some(1)), Some(MIN_TOOL_TIMEOUT_SECONDS));
        assert_eq!(seconds(Some(u64::MAX)), Some(MAX_TOOL_TIMEOUT_SECONDS));
    }

    #[test]
    fn a_serialised_message_is_exactly_one_line() {
        // The transport depends on this: an embedded newline would split one
        // message into two frames and desynchronise the stream.
        let message = json!({ "jsonrpc": "2.0", "id": 1, "method": "x", "params": { "text": "a\nb" } });
        let line = serde_json::to_string(&message).expect("serialising must succeed");
        assert!(!line.contains('\n'), "serialised message contained a newline: {line}");
    }

    #[test]
    fn notifications_are_routed_away_from_responses() {
        // A notification (no `id`) must reach the sink, while the response that
        // follows on the same stream must still reach the response channel. This
        // is what lets a stream of agent deltas coexist with a pending tool call.
        let (sink_tx, sink_rx) = mpsc::channel::<Value>();
        let stream = b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/agent/stream\",\"params\":{\"type\":\"answer_delta\"}}\n{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n";
        let responses = spawn_line_reader(std::io::Cursor::new(stream.to_vec()), Some(sink_tx));

        let notification = sink_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("a notification should be routed to the sink");
        assert_eq!(
            notification.get("method").and_then(Value::as_str),
            Some("notifications/agent/stream")
        );

        let response = responses
            .recv_timeout(Duration::from_secs(5))
            .expect("a response should stay on the response channel");
        let response: Value = serde_json::from_str(&response).expect("the response must parse");
        assert_eq!(response.get("id").and_then(Value::as_u64), Some(1));
    }

    #[test]
    fn unwrap_result_returns_the_result_object() {
        let response = json!({ "jsonrpc": "2.0", "id": 1, "result": { "ok": true } });
        let result = unwrap_result(response).expect("a result response must unwrap");
        assert_eq!(result.get("ok").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn unwrap_result_surfaces_a_jsonrpc_error() {
        let response = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": { "code": -32601, "message": "Method not found" },
        });
        let error = unwrap_result(response).expect_err("an error response must not unwrap");
        let text = error.to_string();
        assert!(text.contains("Method not found"), "error lost the server message: {text}");
    }

    #[test]
    fn unwrap_result_rejects_a_response_with_neither_result_nor_error() {
        let response = json!({ "jsonrpc": "2.0", "id": 1 });
        assert!(unwrap_result(response).is_err());
    }

    /// End-to-end: the real handshake against the real core.
    ///
    /// Ignored by default because it needs a built bundle and a Node runtime.
    /// CI runs it explicitly with `--ignored`, which is why the guard is an
    /// `#[ignore]` attribute rather than a silent early return: a test that
    /// quietly passes when its subject is absent is worse than no test.
    #[test]
    #[ignore = "requires a built core bundle and node on PATH; run with --ignored"]
    fn handshakes_with_the_real_core() {
        let workspace = std::env::var("NEXUS_CORE_WORKSPACE").expect(
            "NEXUS_CORE_WORKSPACE must name the workspace root holding dist/core.mjs",
        );

        // In the CI checkout the repository is both the app root and the project
        // being edited, so a single path serves for both.
        let app_root = Path::new(&workspace);
        let config = CoreConfig::for_app_root(app_root);
        let child = spawn_core(&config, app_root).expect("failed to spawn the core");

        let mut session = CoreSession::start(child).expect("failed to attach to the core");

        let initialized = match session.initialize(STEP_TIMEOUT) {
            Ok(result) => result,
            Err(error) => {
                panic!(
                    "initialize failed: {error}\ncore stderr:\n{}",
                    session.stderr_tail().join("\n")
                );
            }
        };

        let server_name = initialized
            .get("serverInfo")
            .and_then(|info| info.get("name"))
            .and_then(Value::as_str);
        assert_eq!(
            server_name,
            Some("nexus-agent-studio"),
            "unexpected server identity: {initialized}"
        );

        let version = session.negotiated_version().unwrap_or("<absent>").to_owned();

        let tools = match session.list_tools(STEP_TIMEOUT) {
            Ok(tools) => tools,
            Err(error) => {
                panic!(
                    "tools/list failed after negotiating {version}: {error}\ncore stderr:\n{}",
                    session.stderr_tail().join("\n")
                );
            }
        };

        let mut sorted = tools.clone();
        sorted.sort();
        assert_eq!(
            sorted,
            vec![
                "ask_agent",
                "configure_language_server",
                "get_diagnostics",
                "get_editor_context",
                "list_directory",
                "list_language_servers",
                "list_models",
                "read_file",
                "run_terminal_command",
                "set_editor_context",
                "write_file",
            ],
            "tool list did not match the expected surface"
        );

        // Actually invoke a tool. Listing proves the schemas arrived; calling one
        // proves the handler ran and the result came back over the wire.
        let read = match session.call_tool(
            "read_file",
            json!({ "path": "package.json" }),
            Some(STEP_TIMEOUT),
        ) {
            Ok(result) => result,
            Err(error) => panic!("tools/call read_file failed after negotiating {version}: {error}"),
        };

        assert!(
            read.get("isError").and_then(Value::as_bool) != Some(true),
            "read_file reported isError: {read}"
        );

        let rendered = serde_json::to_string(&read).expect("the result must serialise");
        let head: String = rendered.chars().take(200).collect();
        assert!(
            rendered.contains("nexus-agent-studio"),
            "read_file did not return the manifest; got: {head}"
        );

        // Emitted as a workflow command so the negotiated revision, the tool
        // count and the tool call become a check-run annotation. Without it, the
        // only way to learn what the core actually agreed to would be the raw job
        // log, which is not downloadable without authentication.
        println!(
            "::notice::mcp handshake ok: negotiated protocol {version}, {} tools, tools/call ok",
            tools.len()
        );

        session.shutdown(Duration::from_secs(10)).expect("failed to shut the core down");
    }
}
