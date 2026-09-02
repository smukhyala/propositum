//! What has to be true before a child is worth starting.
//!
//! Three checks, in the order they can fail:
//!
//!   1. **`prisma db push`, every launch.** `db push` silently drops the
//!      append-only triggers on any table it rebuilds, and the reinstall-and-
//!      verify runs once per process inside `createDatabase()` — so the push
//!      must COMPLETE before either child starts, and then each child's own
//!      startup re-verifies. Ordering is the whole mechanism: there is no
//!      "restart after upgrade" step because every launch is one. In bundled
//!      mode the push runs with the supervisor's explicit child environment,
//!      because `DATABASE_URL` points into the state dir rather than at a
//!      dotfile beside the code.
//!   2. **A built app.** `next start` refuses without `.next`. A checkout
//!      builds once on first launch after a clone or a `git pull`, logged,
//!      with the *Rebuild and restart* menu item covering staleness. A bundle
//!      ships `.next` prebuilt by `scripts/stage-runtime.ts`, which asserts
//!      `BUILD_ID` exists before anything is bundled — so a bundled launch
//!      that finds no `BUILD_ID` is holding a damaged copy and parks rather
//!      than spending minutes building inside a sealed, read-only bundle it
//!      could not write to anyway.
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
use crate::runtime::{Mode, Runtime};

pub enum Outcome {
    Ready,
    Parked(String),
}

/// db push, then build-if-missing. Blocking — run on the preflight thread,
/// never the main one.
pub fn run(logger: &Arc<Logger>, runtime: &Runtime) -> Outcome {
    let node = match runtime.node() {
        Some(found) => found,
        None => {
            return Outcome::Parked(match runtime.mode {
                Mode::Bundled => "this install is incomplete — reinstall Propositum".into(),
                Mode::Checkout => {
                    "node was not found — set PROPOSITUM_NODE to its full path and relaunch".into()
                }
            })
        }
    };
    let child_env = runtime.child_env();

    logger.line(
        "tray",
        "prisma db push, so the append-only guards re-verify",
    );
    if !one_shot(
        logger,
        "prisma",
        &node,
        &[
            runtime
                .root
                .join("node_modules/prisma/build/index.js")
                .to_string_lossy()
                .as_ref(),
            "db",
            "push",
            "--skip-generate",
        ],
        runtime,
        &child_env,
    ) {
        return Outcome::Parked(
            "the database schema step failed — the log has prisma's words".into(),
        );
    }

    if !runtime.root.join(".next").join("BUILD_ID").is_file() {
        match runtime.mode {
            Mode::Bundled => {
                return Outcome::Parked("this install is incomplete — reinstall Propositum".into())
            }
            Mode::Checkout => {
                logger.line(
                    "tray",
                    "no built app found — building once, which takes a few minutes",
                );
                if !build_app(logger, &node, runtime) {
                    return Outcome::Parked("the app build failed — the log has its words".into());
                }
            }
        }
    }

    Outcome::Ready
}

/// Checkout-only in practice: the bundle ships `.next` prebuilt and the menu
/// offers *Rebuild and restart* only there.
pub fn build_app(logger: &Arc<Logger>, node: &PathBuf, runtime: &Runtime) -> bool {
    one_shot(
        logger,
        "build",
        node,
        &[
            runtime
                .root
                .join("node_modules/next/dist/bin/next")
                .to_string_lossy()
                .as_ref(),
            "build",
        ],
        runtime,
        &runtime.child_env(),
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
pub fn install_chromium(logger: &Arc<Logger>, runtime: &Runtime) -> bool {
    let Some(node) = runtime.node() else {
        return false;
    };
    one_shot(
        logger,
        "browser",
        &node,
        &[
            runtime
                .root
                .join("node_modules/playwright/cli.js")
                .to_string_lossy()
                .as_ref(),
            "install",
            "chromium",
        ],
        runtime,
        &runtime.child_env(),
    )
}

fn one_shot(
    logger: &Arc<Logger>,
    prefix: &str,
    node: &PathBuf,
    args: &[&str],
    runtime: &Runtime,
    child_env: &[(String, String)],
) -> bool {
    match Command::new(node)
        .args(args)
        .current_dir(&runtime.root)
        .envs(child_env.iter().map(|(key, value)| (key, value)))
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
