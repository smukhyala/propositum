//! The one light, read rather than computed.
//!
//! ADR-0023's table row is the specification: the light renders from
//! `intentionState()`, *"not a second implementation"*. So this polls
//! `GET /api/intention-state` — the route built for exactly this — and renders
//! the `label` it gets back verbatim. The five consumer sentences live in
//! `src/domain/intention/state.ts` under `CONTEXT.md`'s discipline, and no
//! word for them is typed on this side.
//!
//! When the endpoint cannot answer, the fallback is what only the supervisor
//! knows — child liveness. Those words (*Starting…*, *Stopped*, a give-up
//! reason) are supervisor facts, not a sixth `IntentionState`, and they never
//! mix into the five.
//!
//! Five seconds is the poll: loopback plus a few indexed SQLite reads, and a
//! `needs-you` surfacing within five seconds is fast enough for a menu bar.

use std::sync::Arc;
use std::time::Duration;

use tauri::menu::MenuItem;
use tauri::Runtime;

use crate::logs::Logger;
use crate::origin;
use crate::supervisor::{Overall, Supervisor};

const POLL_EVERY: Duration = Duration::from_secs(5);

pub fn start<R: Runtime>(
    status_item: MenuItem<R>,
    supervisor: Arc<Supervisor>,
    logger: Arc<Logger>,
) {
    std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(2))
            .timeout(Duration::from_secs(4))
            .build();
        let url = origin::page("/api/intention-state");
        let mut said_odd_answer = false;

        loop {
            let word = match agent.get(&url).set(origin::CUSTOM_HEADER, "1").call() {
                Ok(response) => {
                    match response
                        .into_json::<serde_json::Value>()
                        .ok()
                        .and_then(|body| {
                            body.get("label")
                                .and_then(|label| label.as_str())
                                .map(String::from)
                        }) {
                        Some(label) => {
                            said_odd_answer = false;
                            label
                        }
                        None => "The app answered oddly — the log has the reply".into(),
                    }
                }
                Err(ureq::Error::Status(code, _)) => {
                    // Reachable but refusing or without the route — an old build, or a
                    // different server on our port. Logged once per streak, not per poll.
                    if !said_odd_answer {
                        logger.line(
                            "tray",
                            &format!(
                                "the light endpoint answered {code} — is the app build current?"
                            ),
                        );
                        said_odd_answer = true;
                    }
                    format!("The app answered {code} — see the log")
                }
                Err(_) => match supervisor.overall() {
                    Overall::Starting => "Starting…".into(),
                    Overall::Up => "Starting…".into(),
                    Overall::Stopped => "Stopped".into(),
                    Overall::GaveUp(reason) => format!("Not running — {reason}"),
                },
            };

            let _ = status_item.set_text(&word);
            std::thread::sleep(POLL_EVERY);
        }
    });
}
