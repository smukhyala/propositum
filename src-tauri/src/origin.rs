//! The fourth pin of port 3117.
//!
//! The other three are `package.json`'s dev and start scripts, the extension's
//! hardcoded `APP_ORIGIN`, and the Google OAuth redirect instructions in
//! `.env.example`. `tests/capture.test.ts` reads the two constants below with a
//! regex and asserts they agree with the scripts — written so an unmatched
//! regex goes red rather than quiet, which is that file's own lesson. Everything
//! in this crate that needs the origin derives it from here; a second literal
//! anywhere in `src-tauri/` is the drift the pin exists to catch.

pub const HOST: &str = "127.0.0.1";
pub const PORT: u16 = 3117;

/// The custom header the app's probe-shy routes require, restated from
/// `src/capture/transport.ts` because Rust cannot import it. `tests/capture.test.ts`
/// pins the two spellings to each other.
pub const CUSTOM_HEADER: &str = "x-propositum-capture";

pub fn app_origin() -> String {
    format!("http://{HOST}:{PORT}")
}

pub fn page(path: &str) -> String {
    format!("{}{}", app_origin(), path)
}
