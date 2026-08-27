//! Every tray string, in one file.
//!
//! ADR-0023 prohibition 5: the tray decides nothing — every control is a link
//! to a page at `127.0.0.1:3117`, where there is room for the whole story. The
//! two exceptions are the two that cannot be links: *Copy diagnostics*, which
//! copies the log file's PATH (never its content — see `logs.rs`), and *Quit*.
//!
//! The status line's words come from the endpoint (`light.rs`) and are not
//! written here. What is written here is read by `tests/tray-strings.test.ts`,
//! which greps every Rust string literal for the words `CONTEXT.md` bans from
//! consumer surfaces — because `tests/consumer-vocabulary.test.ts` reads only
//! the app and the side panel, and cannot see Rust.

use std::sync::Arc;

use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{include_image, App, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

use crate::logs::Logger;
use crate::origin;
use crate::supervisor::Supervisor;

/// Builds the tray and returns the status line's handle for `light.rs` to
/// keep true.
pub fn build<R: Runtime>(
    app: &App<R>,
    supervisor: Arc<Supervisor>,
    logger: Arc<Logger>,
) -> tauri::Result<MenuItem<R>> {
    let status = MenuItemBuilder::with_id("state", "Starting…")
        .enabled(false)
        .build(app)?;
    let open = MenuItemBuilder::with_id("open", "Open Propositum").build(app)?;
    let welcome = MenuItemBuilder::with_id("welcome", "Finish setting up").build(app)?;
    let version = MenuItemBuilder::with_id(
        "version",
        format!("Propositum {}", env!("CARGO_PKG_VERSION")),
    )
    .enabled(false)
    .build(app)?;
    let diagnostics = MenuItemBuilder::with_id("diagnostics", "Copy diagnostics").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit Propositum").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&status)
        .separator()
        .item(&open)
        .item(&welcome)
        .separator()
        .item(&version)
        .item(&diagnostics)
        .separator()
        .item(&quit)
        .build()?;

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
            "welcome" => {
                let _ = app
                    .opener()
                    .open_url(origin::page("/welcome"), None::<&str>);
            }
            "diagnostics" => {
                let path = logger.path().to_string_lossy().into_owned();
                let _ = app.clipboard().write_text(path);
            }
            "quit" => {
                supervisor.shutdown();
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(status)
}
