//! Where the checkout is, and which `node` runs it.
//!
//! Stage 1 supervises the existing repo checkout (ADR-0023 as narrowed by the
//! stage split): the children are `next start` and `scripts/worker.ts` run out
//! of the repository, not a bundled runtime. So this module answers two
//! questions a bundled stage 2 would dissolve — where the repo is, and where
//! `node` is.
//!
//! ── The repo root ────────────────────────────────────────────────────────
//!
//! `PROPOSITUM_REPO` wins, for a built `.app` launched away from the checkout.
//! The fallback is this crate's own location at compile time, which is correct
//! for `npm run tray:dev` and for a `.app` run on the machine that built it —
//! and wrong for a `.dmg` handed to somebody else, which is exactly the case
//! stage 1 does not claim to cover.
//!
//! ── Node resolution, and the shell it mostly avoids ──────────────────────
//!
//! `PROPOSITUM_NODE` wins; then a walk of this process's own `PATH`, which
//! finds it whenever the app was started from a terminal; then one probe of
//! the person's login shell (`$SHELL -lc 'command -v node'`), because a
//! Finder-launched app inherits a `PATH` with no version manager on it. That
//! probe is supervisor plumbing at startup, run once, with a fixed argument —
//! ADR-0025 §3's *no shell* binds the agent's action space, where an action a
//! person could not have performed with a mouse is an action nobody reviewed,
//! and this is neither an action nor the agent's. Stage 2 bundles Node and
//! deletes this paragraph.

use std::path::{Path, PathBuf};

pub fn repo_root() -> PathBuf {
    if let Ok(set) = std::env::var("PROPOSITUM_REPO") {
        return PathBuf::from(set);
    }
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri sits inside the repo")
        .to_path_buf()
}

pub fn node_binary() -> Option<PathBuf> {
    if let Ok(set) = std::env::var("PROPOSITUM_NODE") {
        return Some(PathBuf::from(set));
    }

    if let Some(found) = std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|dir| dir.join("node"))
            .find(|candidate| candidate.is_file())
    }) {
        return Some(found);
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let probe = std::process::Command::new(shell)
        .args(["-lc", "command -v node"])
        .output()
        .ok()?;
    if !probe.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&probe.stdout).trim().to_string();
    if line.is_empty() {
        return None;
    }
    Some(PathBuf::from(line))
}
