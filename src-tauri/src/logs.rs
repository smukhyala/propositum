//! The log file that survives the terminal.
//!
//! Today everything the runtime says is `console.log` to whichever terminal is
//! in front of you, gone when the window closes. This gives both children and
//! the supervisor one file at `~/Library/Logs/Propositum/Propositum.log`,
//! size-rotated once to `.old` at about 5 MB, prefixed per writer so a person
//! can tell the app from the worker from the tray itself.
//!
//! Nothing here is telemetry: the file is written, never read by this process
//! and never sent anywhere. The *Copy diagnostics* menu item copies the PATH to
//! the clipboard rather than the content — worker lines can carry page titles
//! and derived prose, and putting those in a clipboard silently is a choice the
//! person should make with the file open in front of them.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const ROTATE_AT_BYTES: u64 = 5 * 1024 * 1024;

pub struct Logger {
    file: Mutex<File>,
    path: PathBuf,
}

pub fn log_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home)
        .join("Library")
        .join("Logs")
        .join("Propositum")
        .join("Propositum.log")
}

impl Logger {
    pub fn open() -> std::io::Result<Logger> {
        let path = log_path();
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        // Rotate before opening, so one long-lived session cannot grow the file
        // without bound. One `.old` is deliberate: two files bound the disk cost
        // at ~10 MB and a person who wants history has git and the ledger.
        if fs::metadata(&path)
            .map(|meta| meta.len() > ROTATE_AT_BYTES)
            .unwrap_or(false)
        {
            let _ = fs::rename(&path, path.with_extension("log.old"));
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Logger {
            file: Mutex::new(file),
            path,
        })
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    /// One line, prefixed. A poisoned or failed write is swallowed: the log is
    /// a convenience and must never be the reason the supervisor dies — the
    /// same fail direction the worker's sweep wrapper takes.
    pub fn line(&self, prefix: &str, text: &str) {
        if let Ok(mut file) = self.file.lock() {
            let _ = writeln!(file, "[{prefix}] {text}");
        }
    }
}
