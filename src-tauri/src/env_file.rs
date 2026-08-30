//! The one writer `.env` has ever had.
//!
//! Nothing in the repository writes `.env` — it is a hand-edited dotfile, and
//! ADR-0023's Configures row makes this binary the first thing allowed to
//! change that. The writer's whole contract is restraint:
//!
//!   - **Every line it does not own is preserved byte for byte** — comments,
//!     `PROPOSITUM_EXTENSION_ID=`, the Google block, keys it has never heard
//!     of, blank lines, order. The person's file stays the person's file.
//!   - **Atomic**: written to a sibling temp file, fsynced, renamed over. A
//!     crash mid-write leaves the old file, never half of one.
//!   - **Mode 0600**, because the file holds a credential.
//!   - **Refusals are values** (`EnvWriteRefusal`), the same shape every seam
//!     in this repository uses — the settings window renders the sentence and
//!     nothing throws across the boundary.
//!   - **The key never appears in a log, an error, or a return value.**
//!
//! Why the supervisor owns this and not a Next page: a route that writes
//! `.env` hands every local page an HTTP door to the credential file, and
//! `/first-run` deliberately *detects, never collects* the key. The write forces
//! a restart of both children (each reads `.env` once at startup), and the
//! process that owns the restart is the process that owns the write.

use std::fs;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

#[derive(Debug, PartialEq)]
pub enum EnvWriteRefusal {
    Empty,
    HoldsNewline,
    StartsWithHash,
}

impl EnvWriteRefusal {
    pub fn sentence(&self) -> &'static str {
        match self {
            EnvWriteRefusal::Empty => "The key is empty.",
            EnvWriteRefusal::HoldsNewline => {
                "The key holds a line break, which would corrupt the file."
            }
            EnvWriteRefusal::StartsWithHash => {
                "The key starts with #, which would comment itself out."
            }
        }
    }
}

/// The new content, computed pure so the tests need no filesystem: replace the
/// first `ANTHROPIC_API_KEY=` line, or append one, touching nothing else.
pub fn with_key(existing: &str, key: &str) -> Result<String, EnvWriteRefusal> {
    let key = key.trim();
    if key.is_empty() {
        return Err(EnvWriteRefusal::Empty);
    }
    if key.contains('\n') || key.contains('\r') {
        return Err(EnvWriteRefusal::HoldsNewline);
    }
    if key.starts_with('#') {
        return Err(EnvWriteRefusal::StartsWithHash);
    }

    let owned_line = format!("ANTHROPIC_API_KEY={key}");
    let mut lines: Vec<&str> = existing.lines().collect();
    let mine = |line: &str| {
        let unindented = line.trim_start();
        unindented
            .strip_prefix("ANTHROPIC_API_KEY")
            .map(|rest| rest.trim_start().starts_with('='))
            .unwrap_or(false)
    };

    let mut out = String::new();
    match lines.iter().position(|line| mine(line)) {
        Some(index) => {
            lines[index] = &owned_line;
            for line in &lines {
                out.push_str(line);
                out.push('\n');
            }
        }
        None => {
            out.push_str(existing);
            if !existing.is_empty() && !existing.ends_with('\n') {
                out.push('\n');
            }
            out.push_str(&owned_line);
            out.push('\n');
        }
    }
    Ok(out)
}

/// Read, rewrite, rename. An absent `.env` starts empty — `.env.example` is a
/// template for a person to read, not a thing to copy silently.
pub fn write_key(env_path: &Path, key: &str) -> Result<(), String> {
    let existing = fs::read_to_string(env_path).unwrap_or_default();
    let next = with_key(&existing, key).map_err(|refusal| refusal.sentence().to_string())?;

    let tmp = env_path.with_file_name(".env.propositum-tmp");
    let write = || -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        file.write_all(next.as_bytes())?;
        file.sync_all()?;
        fs::rename(&tmp, env_path)
    };
    // The io error's own message never contains the key: nothing here
    // interpolates the value into anything but the file body.
    write().map_err(|error| format!("The file could not be written: {error}"))
}

/// The read half, for the bundled mode where the children no longer sit
/// beside a `.env` they can load themselves: the supervisor parses the
/// state-dir file into pairs and passes them as explicit child environment
/// (`runtime.rs`).
///
/// Deliberately small: `KEY=value` lines, `#` comments and blanks skipped,
/// one pair of matching surrounding quotes stripped, the split at the first
/// `=`. What it does not parse — escapes, `export ` prefixes, multi-line
/// values — has never appeared in `.env.example`, and a line it cannot read
/// is skipped rather than guessed at.
pub fn read_pairs(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (key, value) = line.split_once('=')?;
            let key = key.trim();
            let starts_well = key
                .chars()
                .next()
                .is_some_and(|first| first.is_ascii_alphabetic() || first == '_');
            if !starts_well || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                return None;
            }
            let value = value.trim();
            let unquoted = if value.len() >= 2
                && ((value.starts_with('"') && value.ends_with('"'))
                    || (value.starts_with('\'') && value.ends_with('\'')))
            {
                &value[1..value.len() - 1]
            } else {
                value
            };
            Some((key.to_string(), unquoted.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNTOUCHED: &str = "# a comment the person wrote\nDATABASE_URL=\"file:../propositum.db\"\n\nPROPOSITUM_EXTENSION_ID=abcdefghijklmnopabcdefghijklmnop\n";

    #[test]
    fn replaces_in_place_and_preserves_every_other_byte() {
        let existing = format!("{UNTOUCHED}ANTHROPIC_API_KEY=old-key\nGOOGLE_OAUTH_CLIENT_ID=x\n");
        let next = with_key(&existing, "new-key").unwrap();
        assert_eq!(
            next,
            format!("{UNTOUCHED}ANTHROPIC_API_KEY=new-key\nGOOGLE_OAUTH_CLIENT_ID=x\n")
        );
    }

    #[test]
    fn appends_when_absent_without_disturbing_the_rest() {
        let next = with_key(UNTOUCHED, "a-key").unwrap();
        assert_eq!(next, format!("{UNTOUCHED}ANTHROPIC_API_KEY=a-key\n"));
    }

    #[test]
    fn appends_onto_a_file_missing_its_final_newline() {
        let next = with_key("A=1", "a-key").unwrap();
        assert_eq!(next, "A=1\nANTHROPIC_API_KEY=a-key\n");
    }

    #[test]
    fn starts_an_absent_file_with_only_the_key() {
        let next = with_key("", "a-key").unwrap();
        assert_eq!(next, "ANTHROPIC_API_KEY=a-key\n");
    }

    #[test]
    fn refuses_what_would_corrupt_the_file() {
        assert_eq!(with_key("", "  "), Err(EnvWriteRefusal::Empty));
        assert_eq!(with_key("", "a\nb"), Err(EnvWriteRefusal::HoldsNewline));
        assert_eq!(with_key("", "#key"), Err(EnvWriteRefusal::StartsWithHash));
    }

    #[test]
    fn does_not_mistake_a_lookalike_for_its_own_line() {
        let existing = "MY_ANTHROPIC_API_KEY=other\n";
        let next = with_key(existing, "a-key").unwrap();
        assert_eq!(
            next,
            "MY_ANTHROPIC_API_KEY=other\nANTHROPIC_API_KEY=a-key\n"
        );
    }

    #[test]
    fn reads_pairs_and_skips_what_it_cannot_own() {
        let pairs = read_pairs(
            "# a comment\n\nANTHROPIC_API_KEY=sk-test\nDATABASE_URL=\"file:../propositum.db\"\nQUOTED='a value'\nHOLDS_EQUALS=a=b=c\n2BAD=starts-with-digit\nnot a pair\n",
        );
        assert_eq!(
            pairs,
            vec![
                ("ANTHROPIC_API_KEY".to_string(), "sk-test".to_string()),
                (
                    "DATABASE_URL".to_string(),
                    "file:../propositum.db".to_string()
                ),
                ("QUOTED".to_string(), "a value".to_string()),
                ("HOLDS_EQUALS".to_string(), "a=b=c".to_string()),
            ]
        );
    }

    #[test]
    fn reads_a_crlf_file_without_carrying_the_return() {
        let pairs = read_pairs("A=1\r\nB=2\r\n");
        assert_eq!(
            pairs,
            vec![
                ("A".to_string(), "1".to_string()),
                ("B".to_string(), "2".to_string()),
            ]
        );
    }
}
