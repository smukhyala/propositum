//! Both halves of the runtime, supervised for real use.
//!
//! `scripts/dev.ts` is the shape this absorbs, not the code it reuses — its
//! docblock says so about itself: *"the thing that supervises a real install is
//! the menu-bar app (ADR-0023), and this is the development-time stand-in it
//! will one day absorb."* The rules carried over verbatim:
//!
//!   - **One child dying never takes the other with it** (ADR-0001). Each child
//!     has its own loop on its own thread, and nothing here reaches across.
//!   - **Only `stopping` means deliberate.** The worker's signal handlers make
//!     a stray SIGTERM exit 0, so the exit code cannot be trusted to say
//!     whether anybody meant it.
//!   - **`EX_CONFIG` (78) is never retried** — the child is saying the
//!     configuration is wrong, and respawning it three times says it three
//!     times. Mirrors `src/runtime/exit-codes.ts`.
//!   - **A port already in use gives up rather than crash-looping**, and the
//!     message names `lsof`, the way dev.ts's preflight does.
//!
//! And the one thing dev.ts deliberately lacks that a real install cannot:
//! **backoff**. dev.ts respawns instantly and gives up after three quick
//! failures, which is right for a terminal somebody is watching; here a crash
//! respawns at 1 s doubling to a 30 s ceiling, reset after a minute of uptime,
//! because the person is by definition not watching.
//!
//! What this does not do: watch itself. A wedged tray app is what ADR-0025 §2's
//! kill switch is for, and that is a later slice.

use std::io::{BufRead, BufReader};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::logs::Logger;
use crate::origin;
use crate::repo;

pub const EX_CONFIG: i32 = 78;

const STARTUP_MS: u64 = 3_000;
const QUICK_GIVE_UP: u32 = 3;
const BACKOFF_START_MS: u64 = 1_000;
const BACKOFF_CAP_MS: u64 = 30_000;
const BACKOFF_RESET_AFTER_MS: u64 = 60_000;
const SHUTDOWN_GRACE_MS: u64 = 15_000;

#[derive(Clone, Debug, PartialEq)]
pub enum ChildState {
    Starting,
    Up,
    GaveUp(String),
    Stopped,
}

struct Slot {
    prefix: &'static str,
    pid: Option<u32>,
    state: ChildState,
}

pub struct Supervisor {
    stopping: Arc<AtomicBool>,
    slots: Arc<Mutex<Vec<Slot>>>,
    logger: Arc<Logger>,
}

/// What one glance needs to know when the endpoint cannot answer. These are
/// supervisor facts, not a sixth `IntentionState` — the five members stay the
/// server's, and these words never mix into them.
#[derive(Clone, Debug, PartialEq)]
pub enum Overall {
    Starting,
    Up,
    GaveUp(String),
    Stopped,
}

impl Supervisor {
    /// A supervisor that starts nothing, holding the reason where the light's
    /// fallback will read it — the port preflight's give-up shape.
    pub fn parked(logger: Arc<Logger>, reason: String) -> Arc<Supervisor> {
        let supervisor = Arc::new(Supervisor {
            stopping: Arc::new(AtomicBool::new(true)),
            slots: Arc::new(Mutex::new(Vec::new())),
            logger,
        });
        supervisor.slots.lock().unwrap().push(Slot {
            prefix: "tray",
            pid: None,
            state: ChildState::GaveUp(reason),
        });
        supervisor
    }

    /// A supervisor that has not started yet — the preflight's placeholder, so
    /// the light says *Starting…* while `prisma db push` and a first build run.
    pub fn pending(logger: Arc<Logger>) -> Arc<Supervisor> {
        let supervisor = Arc::new(Supervisor {
            stopping: Arc::new(AtomicBool::new(false)),
            slots: Arc::new(Mutex::new(Vec::new())),
            logger,
        });
        supervisor.slots.lock().unwrap().push(Slot {
            prefix: "tray",
            pid: None,
            state: ChildState::Starting,
        });
        supervisor
    }

    pub fn start(logger: Arc<Logger>) -> Arc<Supervisor> {
        let supervisor = Arc::new(Supervisor {
            stopping: Arc::new(AtomicBool::new(false)),
            slots: Arc::new(Mutex::new(Vec::new())),
            logger,
        });

        let node = match repo::node_binary() {
            Some(found) => found,
            None => {
                // No node, no children — parked rather than looping, with the fix in
                // the log. PROPOSITUM_NODE is the escape hatch repo.rs documents.
                supervisor.logger.line(
          "tray",
          "node was not found on PATH or via the login shell. Set PROPOSITUM_NODE to its full path and relaunch.",
        );
                supervisor.slots.lock().unwrap().push(Slot {
                    prefix: "tray",
                    pid: None,
                    state: ChildState::GaveUp("node was not found — the log has the fix".into()),
                });
                return supervisor;
            }
        };

        let repo_dir = repo::repo_root();
        let children: [(&'static str, Vec<String>); 2] = [
            (
                "app",
                vec![
                    repo_dir
                        .join("node_modules/next/dist/bin/next")
                        .to_string_lossy()
                        .into_owned(),
                    "start".into(),
                    "-H".into(),
                    origin::HOST.into(),
                    "-p".into(),
                    origin::PORT.to_string(),
                ],
            ),
            (
                "worker",
                vec![
                    repo_dir
                        .join("node_modules/tsx/dist/cli.mjs")
                        .to_string_lossy()
                        .into_owned(),
                    "scripts/worker.ts".into(),
                ],
            ),
        ];

        for (index, (prefix, argv)) in children.into_iter().enumerate() {
            supervisor.slots.lock().unwrap().push(Slot {
                prefix,
                pid: None,
                state: ChildState::Starting,
            });
            let supervisor_for_child = Arc::clone(&supervisor);
            let node_for_child = node.clone();
            let repo_for_child = repo_dir.clone();
            std::thread::spawn(move || {
                supervisor_for_child.run_child(index, prefix, node_for_child, argv, repo_for_child);
            });
        }

        supervisor
    }

    fn run_child(
        &self,
        index: usize,
        prefix: &'static str,
        node: std::path::PathBuf,
        argv: Vec<String>,
        repo_dir: std::path::PathBuf,
    ) {
        let mut backoff_ms = BACKOFF_START_MS;
        let mut quick_failures: u32 = 0;

        loop {
            if self.stopping.load(Ordering::SeqCst) {
                self.set_state(index, ChildState::Stopped);
                return;
            }

            // Each child leads its own process group, because a child is a
            // TREE and a pid only names its root. The worker is spawned
            // through tsx's CLI, which runs the real worker as its own child;
            // SIGKILLing the wrapper alone left that grandchild alive — three
            // orphaned workers on 2026-08-27, found by the first hands-on kill
            // switch test. Signalling the negative pgid reaches the whole
            // tree, including whatever the worker itself spawns later
            // (Playwright's Chromium is the one already known).
            let mut child = match Command::new(&node)
                .args(&argv)
                .current_dir(&repo_dir)
                .process_group(0)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(spawned) => spawned,
                Err(error) => {
                    self.logger
                        .line(prefix, &format!("could not be started: {error}"));
                    self.set_state(
                        index,
                        ChildState::GaveUp("could not be started — the log has the error".into()),
                    );
                    return;
                }
            };

            let started = Instant::now();
            self.set_pid(index, Some(child.id()));
            self.set_state(index, ChildState::Up);
            self.logger
                .line("tray", &format!("started {prefix} (pid {})", child.id()));

            let port_taken = Arc::new(AtomicBool::new(false));
            self.pump(prefix, &mut child, &port_taken);

            let status = child.wait();
            let uptime = started.elapsed();
            self.set_pid(index, None);

            if self.stopping.load(Ordering::SeqCst) {
                self.set_state(index, ChildState::Stopped);
                return;
            }

            let code = status.ok().and_then(|s| s.code());
            self.logger.line(
                "tray",
                &format!(
                    "{prefix} exited ({}) after {:?}",
                    code.map_or("signal".into(), |c| c.to_string()),
                    uptime
                ),
            );

            if code == Some(EX_CONFIG) {
                self.set_state(
                    index,
                    ChildState::GaveUp(
                        "said its configuration is wrong — its own instruction is in the log"
                            .into(),
                    ),
                );
                return;
            }
            if port_taken.load(Ordering::SeqCst) {
                self.set_state(
                    index,
                    ChildState::GaveUp(format!(
                        "something else has port {} — `lsof -i :{}` names it",
                        origin::PORT,
                        origin::PORT
                    )),
                );
                return;
            }
            if uptime < Duration::from_millis(STARTUP_MS) {
                quick_failures += 1;
                if quick_failures >= QUICK_GIVE_UP {
                    self.set_state(index, ChildState::GaveUp("failed three times in a row at startup — its last words are in the log".into()));
                    return;
                }
            } else {
                quick_failures = 0;
            }

            if uptime >= Duration::from_millis(BACKOFF_RESET_AFTER_MS) {
                backoff_ms = BACKOFF_START_MS;
            }
            self.set_state(index, ChildState::Starting);
            self.sleep_unless_stopping(backoff_ms);
            backoff_ms = (backoff_ms * 2).min(BACKOFF_CAP_MS);
        }
    }

    /// Both pipes to the log, and the one diagnosis worth sniffing: dev.ts reads
    /// stderr only for `EADDRINUSE`, because a taken port must park the loop
    /// rather than feed it.
    fn pump(&self, prefix: &'static str, child: &mut Child, port_taken: &Arc<AtomicBool>) {
        if let Some(stdout) = child.stdout.take() {
            let logger = Arc::clone(&self.logger);
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    logger.line(prefix, &line);
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let logger = Arc::clone(&self.logger);
            let taken = Arc::clone(port_taken);
            std::thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    if line.contains("EADDRINUSE") {
                        taken.store(true, Ordering::SeqCst);
                    }
                    logger.line(prefix, &line);
                }
            });
        }
    }

    /// SIGTERM, a grace window, then SIGKILL what remains — quitting leaves no
    /// orphan, because an orphaned worker holding a lease is worse than no
    /// worker. SIGTERM first so `installSignalHandlers` can drain.
    pub fn shutdown(&self) {
        self.stopping.store(true, Ordering::SeqCst);

        let pids: Vec<u32> = self
            .slots
            .lock()
            .unwrap()
            .iter()
            .filter_map(|slot| slot.pid)
            .collect();

        for pid in &pids {
            // Negative pid: the whole process group, not just the tree's root.
            unsafe { libc::kill(-(*pid as libc::pid_t), libc::SIGTERM) };
        }

        let deadline = Instant::now() + Duration::from_millis(SHUTDOWN_GRACE_MS);
        for pid in &pids {
            while Instant::now() < deadline {
                if unsafe { libc::kill(*pid as libc::pid_t, 0) } != 0 {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            if unsafe { libc::kill(*pid as libc::pid_t, 0) } == 0 {
                self.logger.line(
                    "tray",
                    &format!("pid {pid} did not drain in {SHUTDOWN_GRACE_MS} ms — killed"),
                );
            }
            // The group SIGKILL goes regardless of the root's own state: the
            // root draining does not prove its tree did, and a KILL to a group
            // with no survivors is a no-op.
            unsafe { libc::kill(-(*pid as libc::pid_t), libc::SIGKILL) };
        }
    }

    /// The kill switch's half: SIGKILL, immediately, no grace. Not SIGTERM,
    /// because ADR-0025 §2's verification is `kill -STOP` on the children and
    /// then pressing it — a stopped process cannot run a SIGTERM handler, and
    /// SIGKILL is uncatchable. That asymmetry is the whole reason quitting
    /// drains and stopping does not. A run killed this way surfaces as
    /// interrupted through the worker's startup lease sweep, which is what the
    /// sweep is for.
    pub fn kill_now(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        let mut slots = self.slots.lock().unwrap();
        for slot in slots.iter_mut() {
            if let Some(pid) = slot.pid {
                // The group, not the pid: SIGKILL cannot be forwarded by a
                // wrapper, which is exactly how the first hands-on test of
                // this switch minted three orphaned workers.
                unsafe { libc::kill(-(pid as libc::pid_t), libc::SIGKILL) };
            }
            slot.state = ChildState::Stopped;
        }
        self.logger.line("tray", "stopped by the kill switch");
    }

    pub fn overall(&self) -> Overall {
        let slots = self.slots.lock().unwrap();
        for slot in slots.iter() {
            if let ChildState::GaveUp(reason) = &slot.state {
                return Overall::GaveUp(format!("{}: {}", slot.prefix, reason));
            }
        }
        if slots.iter().all(|slot| slot.state == ChildState::Stopped) {
            return Overall::Stopped;
        }
        if slots.iter().any(|slot| slot.state == ChildState::Starting) {
            return Overall::Starting;
        }
        Overall::Up
    }

    fn set_state(&self, index: usize, state: ChildState) {
        if let Some(slot) = self.slots.lock().unwrap().get_mut(index) {
            slot.state = state;
        }
    }

    fn set_pid(&self, index: usize, pid: Option<u32>) {
        if let Some(slot) = self.slots.lock().unwrap().get_mut(index) {
            slot.pid = pid;
        }
    }

    fn sleep_unless_stopping(&self, total_ms: u64) {
        let deadline = Instant::now() + Duration::from_millis(total_ms);
        while Instant::now() < deadline && !self.stopping.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

/// The tray's one handle on whichever supervisor currently exists.
///
/// The preflight replaces a `pending` supervisor with a started one (or a
/// parked one, when a check fails), and every consumer — the light, the menu,
/// the kill switch, the exit handler — reads through here, so nobody holds a
/// stale `Arc` across the swap.
pub struct RuntimeHold {
    pub logger: Arc<Logger>,
    current: Mutex<Arc<Supervisor>>,
}

impl RuntimeHold {
    pub fn new(logger: Arc<Logger>, initial: Arc<Supervisor>) -> Arc<RuntimeHold> {
        Arc::new(RuntimeHold {
            logger,
            current: Mutex::new(initial),
        })
    }

    pub fn replace(&self, next: Arc<Supervisor>) {
        *self.current.lock().unwrap() = next;
    }

    pub fn overall(&self) -> Overall {
        self.current.lock().unwrap().overall()
    }

    pub fn shutdown(&self) {
        let held = Arc::clone(&self.current.lock().unwrap());
        held.shutdown();
    }

    pub fn kill_now(&self) {
        let held = Arc::clone(&self.current.lock().unwrap());
        held.kill_now();
    }
}
