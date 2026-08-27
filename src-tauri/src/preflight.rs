//! What has to be true before a child is worth starting.
//!
//! Three checks, in the order they can fail:
//!
//!   1. **`prisma db push`, every launch.** `db push` silently drops the
//!      append-only triggers on any table it rebuilds, and the reinstall-and-
//!      verify runs once per process inside `createDatabase()` — so the push
//!      must COMPLETE before either child starts, and then each child's own
//!      startup re-verifies. Ordering is the whole mechanism: there is no
//!      "restart after upgrade" step because every launch is one.
//!   2. **A built app.** `next start` refuses without `.next`; the first
//!      launch after a clone or a `git pull` builds once, logged, and the
//!      *Rebuild and restart* menu item covers staleness — stage 1 does no
//!      staleness detection and says so in the README.
//!   3. **The background browser**, checked but never installed silently. The
//!      worker fails at the first fetch inside a run when Playwright's
//!      Chromium is missing, with no user-facing message — so the tray checks
//!      the cache directory up front and offers a one-click install. The glob
//!      is a heuristic over Playwright's cache layout, not a launch test: a
//!      corrupt install passes it and still fails at first fetch.

use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

use crate::logs::Logger;
use crate::repo;

pub enum Outcome {
    Ready,
    Parked(String),
}

/// db push, then build-if-missing. Blocking — run on the preflight thread,
/// never the main one.
pub fn run(logger: &Arc<Logger>) -> Outcome {
    let node = match repo::node_binary() {
        Some(found) => found,
        None => {
            return Outcome::Parked(
                "node was not found — set PROPOSITUM_NODE to its full path and relaunch".into(),
            )
        }
    };
    let repo_dir = repo::repo_root();

    logger.line(
        "tray",
        "prisma db push, so the append-only guards re-verify",
    );
    if !one_shot(
        logger,
        "prisma",
        &node,
        &[
            repo_dir
                .join("node_modules/prisma/build/index.js")
                .to_string_lossy()
                .as_ref(),
            "db",
            "push",
            "--skip-generate",
        ],
    ) {
        return Outcome::Parked(
            "the database schema step failed — the log has prisma's words".into(),
        );
    }

    if !repo_dir.join(".next").join("BUILD_ID").is_file() {
        logger.line(
            "tray",
            "no built app found — building once, which takes a few minutes",
        );
        if !build_app(logger, &node) {
            return Outcome::Parked("the app build failed — the log has its words".into());
        }
    }

    Outcome::Ready
}

pub fn build_app(logger: &Arc<Logger>, node: &PathBuf) -> bool {
    let repo_dir = repo::repo_root();
    one_shot(
        logger,
        "build",
        node,
        &[
            repo_dir
                .join("node_modules/next/dist/bin/next")
                .to_string_lossy()
                .as_ref(),
            "build",
        ],
    )
}

pub fn chromium_missing() -> bool {
    let cache = std::env::var("PLAYWRIGHT_BROWSERS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
            PathBuf::from(home)
                .join("Library")
                .join("Caches")
                .join("ms-playwright")
        });
    let Ok(entries) = std::fs::read_dir(cache) else {
        return true;
    };
    !entries
        .filter_map(Result::ok)
        .any(|entry| entry.file_name().to_string_lossy().starts_with("chromium"))
}

/// The person's click is the consent; the download is ~150 MB and the log
/// shows its progress. The tray runs it rather than pointing at a page,
/// because it is the supervisor — it already spawns this repository's
/// processes, and a web page cannot install anything.
pub fn install_chromium(logger: &Arc<Logger>) -> bool {
    let Some(node) = repo::node_binary() else {
        return false;
    };
    let repo_dir = repo::repo_root();
    one_shot(
        logger,
        "browser",
        &node,
        &[
            repo_dir
                .join("node_modules/playwright/cli.js")
                .to_string_lossy()
                .as_ref(),
            "install",
            "chromium",
        ],
    )
}

fn one_shot(logger: &Arc<Logger>, prefix: &str, node: &PathBuf, args: &[&str]) -> bool {
    match Command::new(node)
        .args(args)
        .current_dir(repo::repo_root())
        .output()
    {
        Ok(output) => {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                logger.line(prefix, line);
            }
            for line in String::from_utf8_lossy(&output.stderr).lines() {
                logger.line(prefix, line);
            }
            output.status.success()
        }
        Err(error) => {
            logger.line(prefix, &format!("could not be started: {error}"));
            false
        }
    }
}
