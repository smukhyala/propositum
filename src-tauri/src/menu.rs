//! Every tray string, in one file.
//!
//! ADR-0023 prohibition 5: the tray decides nothing — every control is a link
//! to a page at `127.0.0.1:3117`, where there is room for the whole story. The
//! exceptions are the ones that cannot be links, because they act on the
//! runtime itself: *Set the API key…* (the one window, because a menu cannot
//! take text), *Rebuild and restart*, the browser install, *Copy diagnostics*
//! (the log's PATH, never its content — see `logs.rs`), the kill switch, and
//! *Quit*. None of them decides anything about the person's work.
//!
//! The status line's words come from the endpoint (`light.rs`) and are not
//! written here. What is written here is read by `tests/tray-strings.test.ts`,
//! which greps every Rust string literal for the words `CONTEXT.md` bans from
//! consumer surfaces — because `tests/consumer-vocabulary.test.ts` reads only
//! the app and the side panel, and cannot see Rust.

use std::sync::Arc;

use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{include_image, App, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry};
// Manager is load-bearing twice over: get_webview_window for the settings
// window, and tray_by_id for the kill switch's visible word.
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

use crate::origin;
use crate::preflight;
use crate::runtime::{Mode, Runtime};
use crate::supervisor::RuntimeHold;

/// The two items other hands need after the build: the light keeps `status`
/// true, and the kill switch enables `start_again`.
pub struct TrayHandles {
    pub status: MenuItem<Wry>,
    pub start_again: MenuItem<Wry>,
}

pub fn build(
    app: &App<Wry>,
    hold: Arc<RuntimeHold>,
    chromium_missing: bool,
    runtime: Arc<Runtime>,
) -> tauri::Result<TrayHandles> {
    let status = MenuItemBuilder::with_id("state", "Starting…")
        .enabled(false)
        .build(app)?;
    let open = MenuItemBuilder::with_id("open", "Open Propositum").build(app)?;
    let first_run = MenuItemBuilder::with_id("first-run", "Finish setting up").build(app)?;
    let set_key = MenuItemBuilder::with_id("set-key", "Set the API key…").build(app)?;
    let browser = MenuItemBuilder::with_id(
        "install-browser",
        "The background browser is missing — click to install it",
    )
    .build(app)?;
    let rebuild = MenuItemBuilder::with_id("rebuild", "Rebuild and restart").build(app)?;
    let version = MenuItemBuilder::with_id(
        "version",
        format!("Propositum {}", env!("CARGO_PKG_VERSION")),
    )
    .enabled(false)
    .build(app)?;
    let diagnostics = MenuItemBuilder::with_id("diagnostics", "Copy diagnostics").build(app)?;
    let stop_now = MenuItemBuilder::with_id("stop-now", "Stop Propositum now").build(app)?;
    let start_again = MenuItemBuilder::with_id("start-again", "Start Propositum again")
        .enabled(false)
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit Propositum").build(app)?;

    let mut builder = MenuBuilder::new(app)
        .item(&status)
        .separator()
        .item(&open)
        .item(&first_run)
        .item(&set_key)
        .separator();
    if chromium_missing {
        builder = builder.item(&browser);
    }
    // A sealed bundle ships `.next` prebuilt and cannot write into itself, so
    // there is nothing for *Rebuild and restart* to do there — the item exists
    // only where the code can have moved under the binary, which is a checkout.
    if runtime.mode == Mode::Checkout {
        builder = builder.item(&rebuild);
    }
    if chromium_missing || runtime.mode == Mode::Checkout {
        builder = builder.separator();
    }
    let menu = builder
        .item(&version)
        .item(&diagnostics)
        .separator()
        .item(&stop_now)
        .item(&start_again)
        .item(&quit)
        .build()?;

    let handles = TrayHandles {
        status: status.clone(),
        start_again: start_again.clone(),
    };

    TrayIconBuilder::with_id("propositum")
        .icon(include_image!("./icons/tray-template.png"))
        .icon_as_template(true)
        .tooltip("Propositum")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => {
                let _ = app.opener().open_url(origin::page("/"), None::<&str>);
            }
            // The window, not a browser tab: the settings window is the
            // precedent for what cannot be a link, and one native surface is
            // the todo 09 design's whole point. A second click focuses the
            // one that exists.
            "first-run" => first_run_window(app),
            "set-key" => settings_window(app),
            "install-browser" => {
                let hold = Arc::clone(&hold);
                let runtime = Arc::clone(&runtime);
                let browser = browser.clone();
                let _ = browser.set_text("Installing the background browser…");
                let _ = browser.set_enabled(false);
                std::thread::spawn(move || {
                    let done = preflight::install_chromium(&hold.logger, &runtime);
                    let _ = browser.set_text(if done {
                        "The background browser is installed"
                    } else {
                        "The install failed — the log has the error"
                    });
                    let _ = browser.set_enabled(!done);
                });
            }
            "rebuild" => {
                let hold = Arc::clone(&hold);
                let runtime = Arc::clone(&runtime);
                let status = status.clone();
                let app = app.clone();
                let _ = status.set_text("Rebuilding…");
                std::thread::spawn(move || {
                    hold.shutdown();
                    match runtime.node() {
                        Some(node) if preflight::build_app(&hold.logger, &node, &runtime) => {
                            app.restart()
                        }
                        _ => {
                            let _ = status.set_text("The rebuild failed — see the log");
                        }
                    }
                });
            }
            "diagnostics" => {
                let path = hold.logger.path().to_string_lossy().into_owned();
                let _ = app.clipboard().write_text(path);
            }
            "stop-now" => {
                hold.kill_now();
                let _ = status.set_text("Stopped");
                let _ = start_again.set_enabled(true);
                // The word appears in the menu bar itself, beside the ring —
                // the first hands-on test pressed the switch three times
                // because nothing visible confirmed the first press.
                if let Some(tray) = app.tray_by_id("propositum") {
                    let _ = tray.set_title(Some("Stopped"));
                }
            }
            "start-again" => {
                // The whole launch sequence is the restart — preflights
                // included — so relaunching the binary is the honest one.
                hold.shutdown();
                app.restart();
            }
            "quit" => {
                hold.shutdown();
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(handles)
}

/// The first-run window: the app's own page at `/first-run`, in a frame
/// without browser chrome, opened on launch while setup is unfinished and
/// from *Finish setting up*. Everything in it is the page deciding on the
/// app's own facts, so ADR-0023 prohibition 5 stands — and the label
/// `first-run` matches no capability, so the window has no IPC at all;
/// `tests/tray-permissions.test.ts`'s pins hold untouched.
pub fn first_run_window(app: &AppHandle<Wry>) {
    if let Some(existing) = app.get_webview_window("first-run") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }
    let Ok(url) = origin::page("/first-run").parse() else {
        return;
    };
    // External links — t.me for the phone card — belong in the person's real
    // browser, not trapped in this frame. Ours is an exact scheme-host-port
    // match, never a string prefix (a prefix admits :31170 and userinfo
    // tricks into a chrome-less frame titled Propositum); and only web
    // schemes go to the opener, so a file: or custom-scheme URL reaches no
    // OS handler from here.
    let opener = app.clone();
    let _ = WebviewWindowBuilder::new(app, "first-run", WebviewUrl::External(url))
        .title("Propositum")
        .inner_size(720.0, 800.0)
        .on_navigation(move |navigated| {
            let ours = navigated.scheme() == "http"
                && navigated.host_str() == Some(origin::HOST)
                && navigated.port() == Some(origin::PORT);
            if ours {
                return true;
            }
            if navigated.scheme() == "https" || navigated.scheme() == "http" {
                let _ = opener
                    .opener()
                    .open_url(navigated.to_string(), None::<&str>);
            }
            false
        })
        .build();
}

/// The one window: a field for the key, because a menu cannot take text. It
/// decides nothing about the person's work — it holds a form for this
/// machine's own configuration.
fn settings_window(app: &AppHandle<Wry>) {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Propositum")
        .inner_size(460.0, 220.0)
        .resizable(false)
        .build();
}
