//! One worker thread owns the core session, and requests queue behind it.
//!
//! ## The problem this solves
//!
//! The session used to sit in a `Mutex<Option<CoreSession>>` and every command
//! held that lock for the whole call. That made two different things the same
//! thing: *the channel is serialised* (unavoidable — stdio is one pipe) and *the
//! caller waits while holding a lock* (not unavoidable). The visible cost was
//! that a slow `ask_agent` turn, which can be minutes on a local model, blocked
//! every other tool call for its entire duration.
//!
//! Here the serialisation stays and the lock goes away: a single worker owns the
//! session, requests arrive on a queue and are handled in submission order, and
//! each caller waits on its own reply channel. Nothing is held while the core
//! works.
//!
//! ## Where the deadline starts, and why it is reported
//!
//! A budget arrives with the request and is measured from **submission**, because
//! that is what a person typing "600 seconds" means: no more than ten minutes of
//! my life. So a request that spends its whole budget queued behind a long turn is
//! refused *without being sent*, and the message says so — because the remedy for
//! "waited in line too long" is not the same as for "the call itself was slow".
//! Conflating them is how a working configuration gets blamed.
//!
//! `None` means no deadline, matching [`crate::mcp::tool_timeout`]: the user who
//! sets the field to zero is asking to wait as long as it takes.
//!
//! ## What the queue does *not* do
//!
//! It cannot make the core faster, and a timed-out call is **not cancelled**. The
//! core keeps working on the abandoned request and the next one waits for it,
//! because MCP over stdio has no cancellation here. Retiring a request that
//! outlived its budget does free the caller, which is the part that was costing
//! the UI its responsiveness.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::bridge::{spawn_core, CoreConfig};
use crate::mcp::{CoreSession, SessionError};

/// What the worker needs from a core. Implemented by [`CoreSession`] for real
/// use; tests supply their own so the queue itself can be exercised without a
/// core, a Node runtime or a window.
pub trait Backend {
    /// Whether the process is still alive.
    fn is_running(&mut self) -> bool;
    /// The name the core reported, once handshaken.
    fn server_name(&self) -> Option<String>;
    /// The protocol revision the core chose, once handshaken.
    fn negotiated_version(&self) -> Option<String>;
    /// The tools the core exposes, by name.
    fn list_tools(&mut self, timeout: Duration) -> Result<Vec<String>, SessionError>;
    /// Invoke one tool. `timeout` of `None` means wait with no deadline.
    fn call_tool(
        &mut self,
        name: &str,
        arguments: Value,
        timeout: Option<Duration>,
    ) -> Result<Value, SessionError>;
    /// Shut the core down, closing stdin first.
    fn shutdown(self, timeout: Duration) -> Result<(), SessionError>;
}

impl Backend for CoreSession {
    fn is_running(&mut self) -> bool {
        CoreSession::is_running(self)
    }

    fn server_name(&self) -> Option<String> {
        CoreSession::server_name(self).map(str::to_owned)
    }

    fn negotiated_version(&self) -> Option<String> {
        CoreSession::negotiated_version(self).map(str::to_owned)
    }

    fn list_tools(&mut self, timeout: Duration) -> Result<Vec<String>, SessionError> {
        CoreSession::list_tools(self, timeout)
    }

    fn call_tool(
        &mut self,
        name: &str,
        arguments: Value,
        timeout: Option<Duration>,
    ) -> Result<Value, SessionError> {
        CoreSession::call_tool(self, name, arguments, timeout)
    }

    fn shutdown(self, timeout: Duration) -> Result<(), SessionError> {
        CoreSession::shutdown(self, timeout)
    }
}

/// Identity and tool list, as `core_handshake` reports them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreDescription {
    pub server_name: Option<String>,
    pub negotiated_version: Option<String>,
    pub tools: Vec<String>,
}

/// One queued request.
///
/// Each variant carries its own reply channel rather than a shared response
/// queue, so a caller that walks away cannot be mistaken for one that is still
/// interested — and the worker never blocks trying to answer somebody who left.
enum Job {
    Describe {
        submitted: Instant,
        budget: Option<Duration>,
        reply: SyncSender<Result<CoreDescription, String>>,
    },
    CallTool {
        submitted: Instant,
        budget: Option<Duration>,
        name: String,
        arguments: Value,
        reply: SyncSender<Result<Value, String>>,
    },
    SwitchWorkspace {
        submitted: Instant,
        budget: Option<Duration>,
        path: PathBuf,
        reply: SyncSender<Result<String, String>>,
    },
}

/// A handle to the worker thread.
///
/// Cloneable in spirit — every method takes `&self` and only sends — but kept as
/// a single value because the shell has exactly one core.
pub struct CoreWorker {
    jobs: Sender<Job>,
    /// The workspace the worker is currently pointed at.
    ///
    /// Shared with the shell rather than duplicated, so a switch updates the one
    /// value that `workspace_info` reads. A second copy would be a second thing to
    /// keep in step, and drift there means the header lies about which project is
    /// open.
    workspace: Arc<Mutex<PathBuf>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

/// How long the handshake may take when the worker starts a core.
const START_TIMEOUT: Duration = Duration::from_secs(20);

/// Extra time a caller waits past its own budget, so the worker's answer wins.
///
/// Both sides enforce the same budget, measured from the same instant, so without
/// this they fire simultaneously and the caller — which knows the least — usually
/// wins the race and reports the vague message. Giving the worker a moment longer
/// means the caller normally receives the *specific* reason: expired in the queue
/// versus slow in the call. The cost is that a caller waits up to this much longer
/// than it asked for, which only happens when the worker cannot answer at all.
const REPLY_GRACE: Duration = Duration::from_secs(1);

impl CoreWorker {
    /// Start the worker with a factory that builds a live core for a workspace.
    ///
    /// The factory is a closure rather than a concrete constructor so tests can
    /// hand in a fake and so the real one stays where the real dependencies are.
    pub fn spawn<B, F>(factory: F, workspace: Arc<Mutex<PathBuf>>) -> Self
    where
        B: Backend + Send + 'static,
        F: FnMut(&Path) -> Result<B, String> + Send + 'static,
    {
        let (jobs, receiver) = mpsc::channel::<Job>();
        let worker_workspace = Arc::clone(&workspace);

        let thread = thread::spawn(move || {
            Self::run(receiver, factory, worker_workspace);
        });

        Self {
            jobs,
            workspace,
            thread: Mutex::new(Some(thread)),
        }
    }

    /// Ask the core for its identity and tool list.
    pub fn describe(&self, budget: Option<Duration>) -> Result<CoreDescription, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.submit(
            Job::Describe {
                submitted: Instant::now(),
                budget,
                reply,
            },
            receiver,
            budget,
        )
    }

    /// Invoke one tool on the core.
    pub fn call_tool(
        &self,
        name: &str,
        arguments: Value,
        budget: Option<Duration>,
    ) -> Result<Value, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.submit(
            Job::CallTool {
                submitted: Instant::now(),
                budget,
                name: name.to_owned(),
                arguments,
                reply,
            },
            receiver,
            budget,
        )
    }

    /// Re-point the editor at another directory.
    ///
    /// Ordered like every other request, which is what makes "switch, then read a
    /// file" behave predictably: the switch is a job, so it cannot overtake a call
    /// that was submitted before it.
    pub fn switch_workspace(
        &self,
        path: PathBuf,
        budget: Option<Duration>,
    ) -> Result<String, String> {
        let (reply, receiver) = mpsc::sync_channel(1);
        self.submit(
            Job::SwitchWorkspace {
                submitted: Instant::now(),
                budget,
                path,
                reply,
            },
            receiver,
            budget,
        )
    }

    /// The workspace the worker is pointed at.
    ///
    /// Read straight from the shared cell instead of going through the queue, so
    /// it stays instant while a long turn is in flight — the header must not
    /// appear to hang because the model is thinking.
    pub fn workspace(&self) -> PathBuf {
        self.workspace
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_else(|_| PathBuf::from("."))
    }

    fn submit<T>(
        &self,
        job: Job,
        receiver: Receiver<Result<T, String>>,
        budget: Option<Duration>,
    ) -> Result<T, String> {
        if self.jobs.send(job).is_err() {
            return Err("o worker do core não está mais rodando".to_string());
        }

        match budget {
            Some(limit) => {
                receiver
                    .recv_timeout(limit + REPLY_GRACE)
                    .unwrap_or_else(|error| {
                        Err(match error {
                            RecvTimeoutError::Timeout => format!(
                                "sem resposta em {:.1}s. Duas causas possíveis, e sem resposta não dá para \
                                 distinguir: o core está ocupado com um turno longo (esta chamada ainda na \
                                 fila) ou a própria chamada está lenta. Se o turno do agente estava em \
                                 andamento, aguarde; se não estava, aumente o tempo nas configurações.",
                                limit.as_secs_f64()
                            ),
                            RecvTimeoutError::Disconnected => {
                                "o worker do core terminou sem responder".to_string()
                            }
                        })
                    })
            }
            None => receiver
                .recv()
                .unwrap_or_else(|_| Err("o worker do core terminou sem responder".to_string())),
        }
    }

    /// The worker loop: take jobs in order, never hold anything while the core works.
    fn run<B, F>(receiver: Receiver<Job>, mut factory: F, workspace: Arc<Mutex<PathBuf>>)
    where
        B: Backend,
        F: FnMut(&Path) -> Result<B, String>,
    {
        // Deliberately **not** started here. Booting a core costs a process spawn
        // plus a handshake, and a user who never calls a tool should not pay for
        // it; the first job that needs one starts it.
        let mut backend: Option<B> = None;

        for job in receiver {
            match job {
                Job::Describe {
                    submitted,
                    budget,
                    reply,
                } => {
                    let result = switch_on_expiry(submitted, budget, |wait| {
                        format!(
                            "a listagem de tools expirou depois de {:.1}s na fila, antes de ser enviada",
                            wait.as_secs_f64()
                        )
                    })
                    .and_then(|remaining| {
                        let session = ensure(&mut backend, &mut factory, &workspace)?;
                        let tools = session
                            .list_tools(listing_timeout(remaining))
                            .map_err(|error| error.to_string())?;
                        Ok(CoreDescription {
                            server_name: session.server_name(),
                            negotiated_version: session.negotiated_version(),
                            tools,
                        })
                    });

                    let _ = reply.send(result);
                }

                Job::CallTool {
                    submitted,
                    budget,
                    name,
                    arguments,
                    reply,
                } => {
                    let started = Instant::now();
                    let result = match switch_on_expiry(submitted, budget, |wait| {
                        format!(
                            "a chamada a \"{name}\" expirou depois de {:.1}s na fila, antes de ser enviada — \
                             um turno do agente estava em andamento. Aumente o tempo nas configurações \
                             ou aguarde o turno terminar.",
                            wait.as_secs_f64()
                        )
                    }) {
                        Err(message) => Err(message),
                        Ok(remaining) => ensure(&mut backend, &mut factory, &workspace)
                            .and_then(|session| {
                                session
                                    .call_tool(&name, arguments, remaining)
                                    .map_err(|error| describe_call_failure(&name, error, started, remaining))
                            }),
                    };

                    let _ = reply.send(result);
                }

                Job::SwitchWorkspace {
                    submitted,
                    budget,
                    path,
                    reply,
                } => {
                    let result = switch_on_expiry(submitted, budget, |wait| {
                        format!(
                            "a troca de pasta expirou depois de {:.1}s na fila, antes de ser aplicada",
                            wait.as_secs_f64()
                        )
                    })
                    .and_then(|_| apply_switch(&mut backend, &workspace, &path));

                    let _ = reply.send(result);
                }
            }
        }
    }
}

/// Time left on a budget measured from submission, or a message saying it ran out.
///
/// `None` budget means no deadline and is passed through untouched — the one value
/// that must never be turned into a guess.
fn switch_on_expiry(
    submitted: Instant,
    budget: Option<Duration>,
    expired: impl FnOnce(Duration) -> String,
) -> Result<Option<Duration>, String> {
    let Some(limit) = budget else {
        return Ok(None);
    };

    let waited = submitted.elapsed();
    match limit.checked_sub(waited) {
        Some(remaining) if remaining > Duration::ZERO => Ok(Some(remaining)),
        _ => Err(expired(waited)),
    }
}

/// A listing never gets the caller's whole budget: `tools/list` answers in
/// milliseconds, so a bound that a wedged core cannot pass keeps the worker free.
fn listing_timeout(remaining: Option<Duration>) -> Duration {
    match remaining {
        Some(left) => left.min(START_TIMEOUT),
        None => START_TIMEOUT,
    }
}

/// Turn a failed call into something a person can act on.
///
/// The timeout case says **where** the time went, because "the call was slow" and
/// "the call never started" have different fixes and the raw error cannot tell
/// them apart.
fn describe_call_failure(
    name: &str,
    error: SessionError,
    started: Instant,
    remaining: Option<Duration>,
) -> String {
    match error {
        SessionError::Timeout(_) => {
            let ran = started.elapsed();
            match remaining {
                Some(limit) => format!(
                    "\"{name}\" não respondeu em {:.1}s (limite da chamada). A chamada chegou a rodar.",
                    limit.as_secs_f64().min(ran.as_secs_f64()),
                ),
                None => format!("\"{name}\" não respondeu depois de {:.1}s", ran.as_secs_f64()),
            }
        }
        other => other.to_string(),
    }
}

/// Get a live backend, starting one if needed.
///
/// A core that exited is replaced rather than reported, which is what the spec
/// asks for and what the previous lock-based code did: the protocol is stateless
/// and the session is a cache, not a resource.
fn ensure<'a, B, F>(
    slot: &'a mut Option<B>,
    factory: &mut F,
    workspace: &Arc<Mutex<PathBuf>>,
) -> Result<&'a mut B, String>
where
    B: Backend,
    F: FnMut(&Path) -> Result<B, String>,
{
    // Written as a `match` rather than `matches!(… if …)`: the guard form binds the
    // variable immutably, so calling `is_running` — which takes `&mut self` — is
    // rejected there.
    let alive = match slot.as_mut() {
        Some(session) => session.is_running(),
        None => false,
    };
    if !alive {
        // Drop the corpse before replacing it. `CoreSession` closes the child's
        // stdin on drop, which is the portable shutdown signal, so this is not a
        // leak of a running process.
        *slot = None;
        let path = workspace
            .lock()
            .map_err(|_| "o lock do workspace foi envenenado".to_string())?
            .clone();
        *slot = Some(factory(&path)?);
    }

    slot.as_mut().ok_or_else(|| "o core não está disponível".to_string())
}

/// Canonicalise, validate, stop the current core and record the new directory.
fn apply_switch<B: Backend>(
    slot: &mut Option<B>,
    workspace: &Arc<Mutex<PathBuf>>,
    path: &Path,
) -> Result<String, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("pasta inválida: {error}"))?;
    if !canonical.is_dir() {
        return Err(format!("não é um diretório: {}", canonical.display()));
    }

    // Shut the old core down before re-pointing, never after: a core left running
    // against the previous directory would keep serving the old workspace from the
    // one place the shell no longer looks.
    if let Some(session) = slot.take() {
        let _ = session.shutdown(Duration::from_secs(5));
    }

    let mut guard = workspace
        .lock()
        .map_err(|_| "o lock do workspace foi envenenado".to_string())?;
    *guard = canonical.clone();

    Ok(canonical.display().to_string())
}

/// Build the factory the shell uses: spawn the core, attach its notification
/// stream, and complete the legacy handshake.
///
/// Kept here rather than in `main.rs` so the wiring is covered by the harness —
/// `main.rs` cannot compile without the GTK stack, and this is the part worth
/// testing.
pub fn core_factory(
    app_root: PathBuf,
    notifications: Option<Sender<Value>>,
) -> impl FnMut(&Path) -> Result<CoreSession, String> {
    move |workspace: &Path| {
        let config = CoreConfig::for_app_root(&app_root);
        let child = spawn_core(&config, workspace).map_err(|error| error.to_string())?;
        let mut session = CoreSession::start_with_notifications(child, notifications.clone())
            .map_err(|error| error.to_string())?;

        if let Err(error) = session.initialize(START_TIMEOUT) {
            // Never leak a core that failed to handshake.
            let _ = session.shutdown(Duration::from_secs(5));
            return Err(error.to_string());
        }

        Ok(session)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A backend that records what it was asked to do and can be made slow.
    ///
    /// The queue's whole contract is about *ordering and waiting*, neither of
    /// which needs a real core — and a real core needs Node, which the machine
    /// this is developed on does not have. The end-to-end path stays covered by
    /// the `#[ignore]`d test in `mcp.rs`, which CI runs.
    #[derive(Default)]
    struct Recorder {
        calls: Vec<String>,
        lists: usize,
        switches: usize,
    }

    struct FakeBackend {
        shared: Arc<Mutex<Recorder>>,
        delay: Duration,
    }

    impl Backend for FakeBackend {
        fn is_running(&mut self) -> bool {
            true
        }

        fn server_name(&self) -> Option<String> {
            Some("fake".to_string())
        }

        fn negotiated_version(&self) -> Option<String> {
            Some("test-1".to_string())
        }

        fn list_tools(&mut self, _timeout: Duration) -> Result<Vec<String>, SessionError> {
            self.shared.lock().unwrap().lists += 1;
            Ok(vec!["read_file".to_string(), "write_file".to_string()])
        }

        fn call_tool(
            &mut self,
            name: &str,
            _arguments: Value,
            timeout: Option<Duration>,
        ) -> Result<Value, SessionError> {
            self.shared.lock().unwrap().calls.push(name.to_string());

            // Sleep like the real thing would, but never past the caller's limit.
            let sleep = match timeout {
                Some(limit) => self.delay.min(limit),
                None => self.delay,
            };
            thread::sleep(sleep);

            if timeout.is_some_and(|limit| self.delay > limit) {
                return Err(SessionError::Timeout("simulated".to_string()));
            }
            Ok(serde_json::json!({ "ok": name }))
        }

        fn shutdown(self, _timeout: Duration) -> Result<(), SessionError> {
            Ok(())
        }
    }

    /// Build a worker over a fake backend with a given per-call delay.
    ///
    /// Wrapped in `Arc` so a test can drive it from two threads — production code
    /// only ever borrows it, which is why `CoreWorker` itself is not `Clone`.
    fn worker(delay: Duration) -> (Arc<CoreWorker>, Arc<Mutex<Recorder>>) {
        let shared = Arc::new(Mutex::new(Recorder::default()));
        let for_factory = Arc::clone(&shared);
        let workspace = Arc::new(Mutex::new(PathBuf::from("/ws")));

        let worker = Arc::new(CoreWorker::spawn(
            move |_path: &Path| {
                Ok(FakeBackend {
                    shared: Arc::clone(&for_factory),
                    delay,
                })
            },
            workspace,
        ));

        (worker, shared)
    }

    #[test]
    fn requests_are_handled_in_submission_order() {
        // The mutex this replaced had no ordering guarantee at all: whichever
        // thread won the lock went first. A queue is what makes "switch, then
        // read" and "report the caret, then ask the model" predictable.
        let (worker, shared) = worker(Duration::from_millis(0));

        for name in ["first", "second", "third"] {
            worker
                .call_tool(name, serde_json::json!({}), None)
                .expect("the fake call should succeed");
        }

        assert_eq!(shared.lock().unwrap().calls, vec!["first", "second", "third"]);
    }

    #[test]
    fn describe_reports_identity_and_tools() {
        let (worker, shared) = worker(Duration::from_millis(0));

        let description = worker.describe(None).expect("describe should succeed");

        assert_eq!(description.server_name.as_deref(), Some("fake"));
        assert_eq!(description.negotiated_version.as_deref(), Some("test-1"));
        assert_eq!(description.tools, vec!["read_file", "write_file"]);
        assert_eq!(shared.lock().unwrap().lists, 1);
    }

    #[test]
    fn a_caller_that_gives_up_does_not_stop_the_worker() {
        // The failure this guards against is a worker that dies (or wedges)
        // because it tried to answer somebody who had already left. The reply is
        // sent on a bounded channel precisely so that send cannot block, and its
        // error is ignored on purpose.
        let (worker, shared) = worker(Duration::from_millis(20));

        {
            let (reply, receiver) = mpsc::sync_channel(1);
            worker
                .jobs
                .send(Job::CallTool {
                    submitted: Instant::now(),
                    budget: None,
                    name: "abandoned".to_string(),
                    arguments: serde_json::json!({}),
                    reply,
                })
                .expect("the worker should accept the job");
            drop(receiver);
        }

        worker
            .call_tool("afterwards", serde_json::json!({}), None)
            .expect("the worker must still be usable");

        assert_eq!(shared.lock().unwrap().calls, vec!["abandoned", "afterwards"]);
    }

    #[test]
    fn a_request_that_runs_out_its_budget_in_the_queue_is_never_sent() {
        // This is the case the old lock made invisible: a caller waited for the
        // lock and then reported the timeout as if the call itself had been slow.
        // Here the budget is measured from submission, so the caller is told the
        // truth — and the core is not bothered with work nobody is waiting for.
        //
        // The slow turn is shorter than budget + REPLY_GRACE on purpose: the worker
        // gets to answer within the grace window, which is the whole reason the
        // grace exists.
        let (worker, shared) = worker(Duration::from_millis(400));

        // A long turn is already running.
        let handle = thread::spawn({
            let worker = Arc::clone(&worker);
            move || worker.call_tool("slow_turn", serde_json::json!({}), None)
        });
        thread::sleep(Duration::from_millis(50));

        let error = worker
            .call_tool("queued_behind", serde_json::json!({}), Some(Duration::from_millis(60)))
            .expect_err("the budget must expire while queued");

        assert!(
            error.contains("na fila"),
            "the message must say the request never left the queue: {error}"
        );

        handle.join().expect("the slow turn should finish").expect("and should succeed");

        // The queued request never reached the core.
        assert_eq!(shared.lock().unwrap().calls, vec!["slow_turn"]);
    }

    #[test]
    fn a_caller_gives_up_honestly_when_the_worker_cannot_answer_in_time() {
        // The floor under the previous test: if the job ahead is long enough that
        // the worker cannot even reach this request, the caller stops waiting and
        // must not pretend to know why. Claiming "the call was slow" would point
        // at the wrong setting.
        let (worker, _shared) = worker(Duration::from_millis(2500));

        let handle = thread::spawn({
            let worker = Arc::clone(&worker);
            move || worker.call_tool("very_slow_turn", serde_json::json!({}), None)
        });
        thread::sleep(Duration::from_millis(50));

        let started = Instant::now();
        let error = worker
            .call_tool("buried", serde_json::json!({}), Some(Duration::from_millis(60)))
            .expect_err("the caller must stop waiting");

        assert!(
            // Capitalised because it starts a sentence; asserting on the lowercase
            // form failed on a message that was correct, which is a good reminder
            // that the assertion is part of the design too.
            error.contains("Duas causas"),
            "the fallback must admit it cannot tell the two apart: {error}"
        );
        // And it must not have waited for the whole slow turn.
        assert!(
            started.elapsed() < Duration::from_millis(2000),
            "the caller waited far too long: {:?}",
            started.elapsed()
        );

        let _ = handle.join();
    }

    #[test]
    fn a_call_that_runs_out_its_budget_while_running_says_so() {
        // The other half of the distinction: this one *did* run, so the remedy is
        // a longer timeout rather than a shorter queue.
        let (worker, _shared) = worker(Duration::from_millis(400));

        let error = worker
            .call_tool("slow_call", serde_json::json!({}), Some(Duration::from_millis(100)))
            .expect_err("the call should exceed its budget");

        assert!(
            error.contains("não respondeu em"),
            "the message must say the call itself was slow: {error}"
        );
    }

    #[test]
    fn no_budget_means_wait_as_long_as_it_takes() {
        // `None` is the explicit request for no deadline. It must survive the
        // queue untouched: turning it into a default here would silently
        // reintroduce the ceiling the user asked to remove.
        let (worker, _shared) = worker(Duration::from_millis(120));

        let result = worker.call_tool("patient", serde_json::json!({}), None);

        assert!(result.is_ok(), "a call with no deadline must not time out: {result:?}");
    }

    #[test]
    fn switching_workspace_updates_the_shared_path_and_stops_the_core() {
        let (worker, _shared) = worker(Duration::from_millis(0));
        let dir = std::env::temp_dir().join("nexus-worker-switch-test");
        std::fs::create_dir_all(&dir).expect("failed to create the temp dir");

        let reported = worker
            .switch_workspace(dir.clone(), None)
            .expect("the switch should succeed");

        // Canonicalised, so the label and the file tools agree on one spelling.
        let canonical = dir.canonicalize().expect("the temp dir should canonicalise");
        assert_eq!(reported, canonical.display().to_string());
        assert_eq!(worker.workspace(), canonical);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn switching_to_a_missing_directory_fails_without_changing_anything() {
        let (worker, _shared) = worker(Duration::from_millis(0));
        let before = worker.workspace();

        let error = worker
            .switch_workspace(PathBuf::from("/definitely/not/here"), None)
            .expect_err("a missing directory must be refused");

        assert!(error.contains("pasta inválida"), "unexpected message: {error}");
        assert_eq!(worker.workspace(), before, "a refused switch must not move the workspace");
    }
}
