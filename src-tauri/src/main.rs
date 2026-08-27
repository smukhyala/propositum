//! The menu-bar app that owns the runtime. ADR-0023, stage 1.
//!
//! One binary that supervises the two Node processes, shows one light, and
//! opens links. It holds no tools, reads no filesystem outside its own
//! configuration and log, adds no sensor, and requests **no TCC permission** —
//! `tests/tray-permissions.test.ts` pins that to the config, and its docblock
//! says what stage 2 must do to change it knowingly.
//!
//! Launch order: single instance → port preflight → children → tray → light.
//! The preflight is dev.ts's argument transplanted: a taken port means a
//! server that is not ours, and a worker started beside it — or a second
//! worker double-draining — is worse than refusing to start.
//!
//! Stage 1 supervises the existing repo checkout. What a stranger's `.dmg`
//! needs — a bundled Node, a built app, signing, `prisma db push` on first
//! launch — is the todo's stage 2 and is deliberately absent here.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod light;
mod logs;
mod menu;
mod origin;
mod repo;
mod supervisor;

use std::net::TcpListener;
use std::sync::Arc;

use tauri::Manager;

use logs::Logger;
use supervisor::Supervisor;

/// Broad-detect, narrow-serve, exactly as `scripts/dev.ts` argues: probe both
/// families so a server bound any which way is seen, while the app itself only
/// ever listens on `127.0.0.1`.
fn port_taken() -> bool {
    let v4 = TcpListener::bind((origin::HOST, origin::PORT));
    let v6 = TcpListener::bind(("::", origin::PORT));
    v4.is_err() || v6.is_err()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // A menu-bar app, not a dock app. Runtime policy rather than an
            // Info.plist key, so the config stays free of platform extras the
            // permissions test would have to allowlist.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let logger = Arc::new(Logger::open()?);
            logger.line(
                "tray",
                &format!("Propositum {} starting", env!("CARGO_PKG_VERSION")),
            );

            let supervisor = if port_taken() {
                logger.line(
                    "tray",
                    &format!(
                        "something else has port {} — `lsof -i :{}` names it. Nothing was started.",
                        origin::PORT,
                        origin::PORT
                    ),
                );
                Supervisor::parked(
                    Arc::clone(&logger),
                    format!(
                        "something else has port {} — `lsof -i :{}` names it",
                        origin::PORT,
                        origin::PORT
                    ),
                )
            } else {
                Supervisor::start(Arc::clone(&logger))
            };

            let status_item = menu::build(app, Arc::clone(&supervisor), Arc::clone(&logger))?;
            light::start(status_item, Arc::clone(&supervisor), logger);

            app.manage(supervisor);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the tray app could not be built")
        .run(|app, event| {
            // Quit from the menu already shut the supervisor down; this catches
            // every other way out, so no exit path leaves an orphaned worker
            // holding a lease.
            if let tauri::RunEvent::Exit = event {
                app.state::<Arc<Supervisor>>().shutdown();
            }
        });
}
