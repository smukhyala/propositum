//! Which tree the children run out of, which `node` runs it, and where the
//! person's state lives. Stage 2 of docs/todo/01: one binary, two modes,
//! resolved once at launch and never re-derived.
//!
//! ── Bundled ──────────────────────────────────────────────────────────────
//!
//! The binary sits in `Propositum.app/Contents/MacOS`, the runtime tree —
//! sources, `node_modules`, a prebuilt `.next`, staged by
//! `scripts/stage-runtime.ts` — sits beside it in `Contents/Resources/runtime`,
//! and Node is the sidecar at `Contents/MacOS/node`. The bundle is sealed by
//! its signature, so nothing here may write into it: everything mutable —
//! `.env`, the database — lives in `~/Library/Application Support/Propositum/`
//! and reaches the children as explicit environment rather than a dotfile
//! beside the code. Explicit env wins in all three of the runtime's dotenv
//! readers (Next, the worker's `loadEnvFile`, Prisma's bundled dotenv), which
//! is what makes the sealed bundle workable without patching any of them.
//!
//! ── Checkout ─────────────────────────────────────────────────────────────
//!
//! `npm run tray:dev`, and any launch with `PROPOSITUM_REPO` set. Exactly
//! stage 1's behaviour, deliberately untouched: the checkout is the root,
//! `.env` lives there, the children inherit this process's environment and
//! nothing is injected. The fallback root is this crate's location at compile
//! time, which is correct for a dev build on the machine that built it and
//! never reached from a shipped `.app` — the Resources check runs first.
//!
//! ── What stage 2 deleted ─────────────────────────────────────────────────
//!
//! Stage 1 probed the person's login shell for `node` (`$SHELL -lc`), because
//! a Finder-launched app inherits a `PATH` with no version manager on it. Its
//! own docblock said "Stage 2 bundles Node and deletes this paragraph", and
//! this is that deletion: a bundled launch uses only the sidecar, and a
//! checkout launch comes from a terminal, where `PROPOSITUM_NODE` or the
//! `PATH` walk is enough. ADR-0025 §3's *no shell* loses its one stated
//! exception.

use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    Bundled,
    Checkout,
}

pub struct Runtime {
    pub mode: Mode,
    /// The tree the children run out of: `Contents/Resources/runtime`, or the
    /// checkout.
    pub root: PathBuf,
    exe_dir: PathBuf,
    home: PathBuf,
}

impl Runtime {
    pub fn resolve() -> Runtime {
        let exe = std::env::current_exe().unwrap_or_default();
        let home = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()));
        resolve_from(
            std::env::var_os("PROPOSITUM_REPO").map(PathBuf::from),
            &exe,
            &home,
        )
    }

    /// The sidecar in bundled mode; `PROPOSITUM_NODE` then a `PATH` walk in a
    /// checkout. `None` is a parked launch, never a guess.
    pub fn node(&self) -> Option<PathBuf> {
        match self.mode {
            Mode::Bundled => {
                let sidecar = self.exe_dir.join("node");
                sidecar.is_file().then_some(sidecar)
            }
            Mode::Checkout => {
                if let Ok(set) = std::env::var("PROPOSITUM_NODE") {
                    return Some(PathBuf::from(set));
                }
                std::env::var_os("PATH").and_then(|path| {
                    std::env::split_paths(&path)
                        .map(|dir| dir.join("node"))
                        .find(|candidate| candidate.is_file())
                })
            }
        }
    }

    /// Where the person's mutable state lives. Hand-rolled from `$HOME` for
    /// symmetry with `logs.rs`'s `~/Library/Logs/Propositum` rather than taken
    /// from Tauri's `app_data_dir`, which would name it by the bundle
    /// identifier and split the naming between two conventions.
    pub fn state_dir(&self) -> PathBuf {
        self.home
            .join("Library")
            .join("Application Support")
            .join("Propositum")
    }

    /// macOS App Translocation runs a quarantined app from a randomised,
    /// read-only mount when Finder never moved it — double-clicked straight
    /// off the dmg is the usual way. Found by the first quarantine launch
    /// test, 2026-08-30: `prisma db push` died on EROFS inside the mount,
    /// visible only in the log. The launch parks instead, with the one
    /// instruction that fixes it. Path-text detection, because that is what
    /// translocation actually changes; a false negative just falls through
    /// to the same EROFS park with a worse sentence.
    pub fn translocated(&self) -> bool {
        self.mode == Mode::Bundled
            && self
                .root
                .components()
                .any(|part| part.as_os_str() == "AppTranslocation")
    }

    /// Bundled mode's one write outside the log: the state dir, 0700, made
    /// before anything asks for `.env` or the database. A checkout has no
    /// state dir and this is a no-op there.
    pub fn ensure_state_dir(&self) -> Result<(), String> {
        if self.mode == Mode::Checkout {
            return Ok(());
        }
        let dir = self.state_dir();
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&dir)
            .map_err(|error| {
                format!(
                    "the state folder could not be created at {}: {error}",
                    dir.display()
                )
            })
    }

    /// The `.env` this binary writes and, in bundled mode, reads back for the
    /// children. Checkout mode keeps stage 1's location in the checkout.
    pub fn env_path(&self) -> PathBuf {
        match self.mode {
            Mode::Bundled => self.state_dir().join(".env"),
            Mode::Checkout => self.root.join(".env"),
        }
    }

    /// The environment the children are spawned with. Checkout: nothing —
    /// they inherit, exactly as stage 1 spawned them, which also means the
    /// telemetry switches below are bundled-only; a checkout is the
    /// developer's environment to set. Bundled: the state-dir `.env` as
    /// pairs, with this binary's own entries appended after a dedupe so no
    /// line in the file can outrank them — `DATABASE_URL` pointing into the
    /// state dir, and Next's and Prisma's phone-homes switched off because a
    /// no-telemetry product does not ship a vendor's exception (Prisma's CLI
    /// checks checkpoint.prisma.io on every `db push` otherwise, which the
    /// preflight runs on every launch).
    pub fn child_env(&self) -> Vec<(String, String)> {
        match self.mode {
            Mode::Checkout => Vec::new(),
            Mode::Bundled => {
                let text = std::fs::read_to_string(self.env_path()).unwrap_or_default();
                let owned = [
                    (
                        "DATABASE_URL".to_string(),
                        format!("file:{}", self.state_dir().join("propositum.db").display()),
                    ),
                    ("NEXT_TELEMETRY_DISABLED".to_string(), "1".to_string()),
                    ("CHECKPOINT_DISABLE".to_string(), "1".to_string()),
                ];
                let mut pairs: Vec<(String, String)> = crate::env_file::read_pairs(&text)
                    .into_iter()
                    .filter(|(key, _)| owned.iter().all(|(ours, _)| ours != key))
                    .collect();
                // ADR-0028's bundled key, the INVERSE of the owned layer: a
                // default seeded only when the person's own `.env` lacks the
                // key, so their key wins by construction rather than by env
                // ordering. Written by `scripts/stage-runtime.ts` from the
                // builder's environment; absent in a keyless build, and then
                // the first run asks — the floor. The value reaches the
                // children's environment and nothing else: no log, no error.
                if !pairs.iter().any(|(key, _)| key == "ANTHROPIC_API_KEY") {
                    if let Ok(bundled) = std::fs::read_to_string(self.root.join("bundled-key")) {
                        let bundled = bundled.trim();
                        if !bundled.is_empty() {
                            pairs.push(("ANTHROPIC_API_KEY".to_string(), bundled.to_string()));
                        }
                    }
                }
                pairs.extend(owned);
                pairs
            }
        }
    }
}

/// Pure so the tests need no bundle: the override wins, then the Resources
/// check, then the compile-time checkout.
fn resolve_from(override_root: Option<PathBuf>, exe: &Path, home: &Path) -> Runtime {
    let exe_dir = exe.parent().unwrap_or(Path::new("/")).to_path_buf();

    if let Some(root) = override_root {
        return Runtime {
            mode: Mode::Checkout,
            root,
            exe_dir,
            home: home.to_path_buf(),
        };
    }

    let bundled_root = exe_dir
        .parent()
        .map(|contents| contents.join("Resources").join("runtime"));
    if let Some(root) = bundled_root.filter(|candidate| candidate.is_dir()) {
        return Runtime {
            mode: Mode::Bundled,
            root,
            exe_dir,
            home: home.to_path_buf(),
        };
    }

    Runtime {
        mode: Mode::Checkout,
        root: Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri sits inside the repo")
            .to_path_buf(),
        exe_dir,
        home: home.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join("propositum-runtime-tests")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn bundled_only_when_the_resources_tree_exists() {
        let app = scratch("bundled");
        std::fs::create_dir_all(app.join("Contents/Resources/runtime")).unwrap();
        std::fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        let exe = app.join("Contents/MacOS/Propositum");

        let resolved = resolve_from(None, &exe, Path::new("/home/person"));
        assert_eq!(resolved.mode, Mode::Bundled);
        assert_eq!(resolved.root, app.join("Contents/Resources/runtime"));

        let bare = scratch("bare");
        let resolved = resolve_from(None, &bare.join("propositum"), Path::new("/home/person"));
        assert_eq!(resolved.mode, Mode::Checkout);
    }

    #[test]
    fn the_override_beats_a_bundle() {
        let app = scratch("override");
        std::fs::create_dir_all(app.join("Contents/Resources/runtime")).unwrap();
        let exe = app.join("Contents/MacOS/Propositum");

        let resolved = resolve_from(
            Some(PathBuf::from("/somewhere/checkout")),
            &exe,
            Path::new("/home/person"),
        );
        assert_eq!(resolved.mode, Mode::Checkout);
        assert_eq!(resolved.root, PathBuf::from("/somewhere/checkout"));
    }

    #[test]
    fn state_paths_keep_the_space_and_stay_absolute() {
        let app = scratch("paths");
        std::fs::create_dir_all(app.join("Contents/Resources/runtime")).unwrap();
        let exe = app.join("Contents/MacOS/Propositum");
        let resolved = resolve_from(None, &exe, Path::new("/Users/person"));

        assert_eq!(
            resolved.state_dir(),
            PathBuf::from("/Users/person/Library/Application Support/Propositum")
        );
        assert_eq!(resolved.env_path(), resolved.state_dir().join(".env"));
        // The relocation probe (2026-08-28) verified Prisma takes this URL
        // unencoded, space and all. No `.env` exists at this fake home, so
        // the pairs are exactly the two owned entries.
        assert_eq!(
            resolved.child_env(),
            vec![
                (
                    "DATABASE_URL".to_string(),
                    "file:/Users/person/Library/Application Support/Propositum/propositum.db"
                        .to_string()
                ),
                ("NEXT_TELEMETRY_DISABLED".to_string(), "1".to_string()),
                ("CHECKPOINT_DISABLE".to_string(), "1".to_string()),
            ]
        );
    }

    fn bundled_home_and_app(name: &str, env_line: Option<&str>) -> (PathBuf, PathBuf) {
        let app = scratch(&format!("{name}-app"));
        std::fs::create_dir_all(app.join("Contents/Resources/runtime")).unwrap();
        let home = scratch(&format!("{name}-home"));
        std::fs::create_dir_all(home.join("Library/Application Support/Propositum")).unwrap();
        if let Some(line) = env_line {
            std::fs::write(
                home.join("Library/Application Support/Propositum/.env"),
                line,
            )
            .unwrap();
        }
        (app, home)
    }

    #[test]
    fn a_bundled_key_seeds_under_an_absent_env_line() {
        let (app, home) = bundled_home_and_app("seed", Some("PROPOSITUM_EXTENSION_ID=x\n"));
        std::fs::write(
            app.join("Contents/Resources/runtime/bundled-key"),
            "sk-bundled\n",
        )
        .unwrap();
        let resolved = resolve_from(None, &app.join("Contents/MacOS/Propositum"), &home);
        let env = resolved.child_env();
        let found: Vec<_> = env
            .iter()
            .filter(|(key, _)| key == "ANTHROPIC_API_KEY")
            .collect();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, "sk-bundled");
        assert!(env
            .iter()
            .any(|(key, value)| key == "PROPOSITUM_EXTENSION_ID" && value == "x"));
    }

    #[test]
    fn the_persons_key_outranks_the_bundled_one() {
        let (app, home) = bundled_home_and_app("outrank", Some("ANTHROPIC_API_KEY=sk-mine\n"));
        std::fs::write(
            app.join("Contents/Resources/runtime/bundled-key"),
            "sk-bundled\n",
        )
        .unwrap();
        let resolved = resolve_from(None, &app.join("Contents/MacOS/Propositum"), &home);
        let env = resolved.child_env();
        let found: Vec<_> = env
            .iter()
            .filter(|(key, _)| key == "ANTHROPIC_API_KEY")
            .collect();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, "sk-mine");
    }

    #[test]
    fn a_missing_or_empty_bundled_key_file_adds_nothing() {
        let (app, home) = bundled_home_and_app("floor", None);
        let resolved = resolve_from(None, &app.join("Contents/MacOS/Propositum"), &home);
        assert!(!resolved
            .child_env()
            .iter()
            .any(|(key, _)| key == "ANTHROPIC_API_KEY"));

        std::fs::write(app.join("Contents/Resources/runtime/bundled-key"), "  \n").unwrap();
        let resolved = resolve_from(None, &app.join("Contents/MacOS/Propositum"), &home);
        assert!(!resolved
            .child_env()
            .iter()
            .any(|(key, _)| key == "ANTHROPIC_API_KEY"));
    }

    #[test]
    fn a_translocated_launch_is_recognised_by_its_path() {
        let app = scratch("transloc");
        std::fs::create_dir_all(
            app.join("AppTranslocation/1D-2E/d/P.app/Contents/Resources/runtime"),
        )
        .unwrap();
        let exe = app.join("AppTranslocation/1D-2E/d/P.app/Contents/MacOS/Propositum");
        let resolved = resolve_from(None, &exe, Path::new("/Users/person"));
        assert_eq!(resolved.mode, Mode::Bundled);
        assert!(resolved.translocated());

        let plain = scratch("not-transloc");
        std::fs::create_dir_all(plain.join("P.app/Contents/Resources/runtime")).unwrap();
        let resolved = resolve_from(
            None,
            &plain.join("P.app/Contents/MacOS/Propositum"),
            Path::new("/Users/person"),
        );
        assert!(!resolved.translocated());
    }

    #[test]
    fn checkout_env_stays_in_the_checkout_and_injects_nothing() {
        let resolved = resolve_from(
            Some(PathBuf::from("/somewhere/checkout")),
            Path::new("/somewhere/bin/propositum"),
            Path::new("/Users/person"),
        );
        assert_eq!(
            resolved.env_path(),
            PathBuf::from("/somewhere/checkout/.env")
        );
        assert!(resolved.child_env().is_empty());
    }

    #[test]
    fn a_env_line_cannot_outrank_the_owned_database_url() {
        let app = scratch("child-env");
        std::fs::create_dir_all(app.join("Contents/Resources/runtime")).unwrap();
        let exe = app.join("Contents/MacOS/Propositum");
        let home = scratch("child-env-home");
        std::fs::create_dir_all(home.join("Library/Application Support/Propositum")).unwrap();
        std::fs::write(
            home.join("Library/Application Support/Propositum/.env"),
            "ANTHROPIC_API_KEY=sk-test\nDATABASE_URL=file:./somewhere-else.db\n",
        )
        .unwrap();

        let resolved = resolve_from(None, &exe, &home);
        let env = resolved.child_env();
        let database_urls: Vec<&(String, String)> = env
            .iter()
            .filter(|(key, _)| key == "DATABASE_URL")
            .collect();
        assert_eq!(database_urls.len(), 1);
        assert!(database_urls[0].1.ends_with("Propositum/propositum.db"));
        assert!(env
            .iter()
            .any(|(key, value)| key == "ANTHROPIC_API_KEY" && value == "sk-test"));
        assert!(env
            .iter()
            .any(|(key, value)| key == "NEXT_TELEMETRY_DISABLED" && value == "1"));
    }
}
