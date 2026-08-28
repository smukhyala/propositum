//! The menu-bar app that owns the runtime. ADR-0023, stage 1.
//!
//! One binary that supervises the two Node processes, shows one light, opens
//! links, holds the one key field, and owns the kill switch. It holds no
//! tools, reads no filesystem outside its own configuration and log, adds no
//! sensor, and requests **no TCC permission** — `tests/tray-permissions.test.ts`
//! pins that to the config, and its docblock says what stage 2 must do to
//! change it knowingly.
//!
//! Launch order: single instance → tray (the light says *Starting…*) → on a
//! worker thread: port preflight, `prisma db push`, build-if-missing → the
//! children. The push always completes before either child starts, so
//! `createDatabase()` in each child reinstalls and verifies the append-only
//! triggers after every push — upgrades included, because every launch is
//! this launch.
//!
//! The kill switch (ADR-0025 §2): a global hotkey and a menu item, both
//! handled here in the Tauri process — not in Node, so they work when the
//! worker is wedged — and stopping never touches the network. What it stops
//! today is the runtime, by SIGKILL; there is no input synthesis yet, and the
//! menu says no more than that.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod env_file;
mod light;
mod logs;
mod menu;
mod origin;
mod preflight;
mod runtime;
mod supervisor;

use std::net::TcpListener;
use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_global_shortcut::ShortcutState;

use logs::Logger;
use runtime::Runtime;
use supervisor::{RuntimeHold, Supervisor};

const KILL_SWITCH: &str = "CmdOrCtrl+Shift+Escape";

/// Broad-detect, narrow-serve, exactly as `scripts/dev.ts` argues: probe both
/// families so a server bound any which way is seen, while the app itself only
/// ever listens on `127.0.0.1`.
fn port_taken() -> bool {
    let v4 = TcpListener::bind((origin::HOST, origin::PORT));
    let v6 = TcpListener::bind(("::", origin::PORT));
    v4.is_err() || v6.is_err()
}

/// The one writer `.env` has ever had, reachable only from the settings
/// window. A refusal comes back as the sentence the window renders; the key
/// itself never appears in a log, an error, or a return value. Where the file
/// lives is the mode's decision (`runtime.env_path()`): the checkout's own
/// `.env`, or the state dir a sealed bundle keeps its configuration in.
#[tauri::command]
fn set_api_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let hold = Arc::clone(&*app.state::<Arc<RuntimeHold>>());
    let held_runtime = Arc::clone(&*app.state::<Arc<Runtime>>());
    env_file::write_key(&held_runtime.env_path(), &key)?;
    hold.logger.line(
        "tray",
        ".env ANTHROPIC_API_KEY updated — restarting both halves for it",
    );
    // Both children read `.env` once at startup, so the write forces the
    // bounce. This is a deliberate configuration change by the person, not a
    // crash — ADR-0001's "one child dying never takes the other" is about
    // failures, and is not being reversed here. Relaunching the binary IS the
    // restart, preflights included.
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        hold.shutdown();
        app.restart();
    });
    Ok(())
}

/// SIGTERM and SIGINT, blocked here and consumed by `watch_exit_signals`.
///
/// tao's event loop installs no signal handler, so before this existed a
/// `kill -TERM` on the tray — launchd's shutdown timeout, a script, a logout
/// path that falls back to signals — terminated it without ever reaching
/// `RunEvent::Exit`, and **both children survived as orphans**. Observed on
/// 2026-08-27, on the day the run-event comment below claimed otherwise:
/// the app child held port 3117 and the worker held its lease. Blocking must
/// happen before any other thread spawns, because a signal mask is inherited
/// and delivery to the `sigwait` thread depends on every other thread having
/// it blocked.
fn block_exit_signals() {
    unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        libc::sigaddset(&mut set, libc::SIGTERM);
        libc::sigaddset(&mut set, libc::SIGINT);
        libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
    }
}

/// One thread, parked in `sigwait`, that turns a signal into the same drain
/// the Quit item runs. Not a signal handler — `sigwait` returns on an
/// ordinary thread, so `shutdown()`'s locks and logging are safe here.
fn watch_exit_signals(hold: Arc<RuntimeHold>) {
    std::thread::spawn(move || unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        libc::sigaddset(&mut set, libc::SIGTERM);
        libc::sigaddset(&mut set, libc::SIGINT);
        let mut which: libc::c_int = 0;
        if libc::sigwait(&set, &mut which) == 0 {
            hold.logger.line(
                "tray",
                "asked to exit by a signal — draining the children first",
            );
            hold.shutdown();
            std::process::exit(0);
        }
    });
}

fn main() {
    block_exit_signals();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut(KILL_SWITCH)
                .expect("the kill-switch shortcut parses")
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        // ADR-0025 §2: stopping never needs the network, and it
                        // works when the runtime is wedged — verified by
                        // `kill -STOP` on the children and then pressing this.
                        if let (Some(hold), Some(handles)) = (
                            app.try_state::<Arc<RuntimeHold>>(),
                            app.try_state::<menu::TrayHandles>(),
                        ) {
                            hold.kill_now();
                            let _ = handles.status.set_text("Stopped");
                            let _ = handles.start_again.set_enabled(true);
                            // Beside the ring, so a press is visibly answered —
                            // the first hands-on test pressed three times
                            // because nothing on screen moved.
                            if let Some(tray) = app.tray_by_id("propositum") {
                                let _ = tray.set_title(Some("Stopped"));
                            }
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![set_api_key])
        .setup(|app| {
            // A menu-bar app, not a dock app. Runtime policy rather than an
            // Info.plist key, so the config stays free of platform extras the
            // permissions test would have to allowlist.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let logger = Arc::new(Logger::open()?);
            let held_runtime = Arc::new(Runtime::resolve());
            logger.line(
                "tray",
                &format!(
                    "Propositum {} starting ({} mode, runtime at {})",
                    env!("CARGO_PKG_VERSION"),
                    match held_runtime.mode {
                        runtime::Mode::Bundled => "bundled",
                        runtime::Mode::Checkout => "checkout",
                    },
                    held_runtime.root.display()
                ),
            );

            let hold = RuntimeHold::new(
                Arc::clone(&logger),
                Supervisor::pending(Arc::clone(&logger)),
            );
            let handles = menu::build(
                app,
                Arc::clone(&hold),
                preflight::chromium_missing(),
                Arc::clone(&held_runtime),
            )?;
            light::start(handles.status.clone(), Arc::clone(&hold));
            app.manage(Arc::clone(&hold));
            app.manage(Arc::clone(&held_runtime));
            app.manage(handles);
            watch_exit_signals(Arc::clone(&hold));

            // The blocking half of the launch, off the main thread so the tray
            // appears immediately with the light on Starting.
            std::thread::spawn(move || {
                if let Err(reason) = held_runtime.ensure_state_dir() {
                    logger.line("tray", &format!("{reason}. Nothing was started."));
                    hold.replace(Supervisor::parked(logger, reason));
                    return;
                }
                if port_taken() {
                    let reason = format!(
                        "something else has port {} — `lsof -i :{}` names it",
                        origin::PORT,
                        origin::PORT
                    );
                    logger.line("tray", &format!("{reason}. Nothing was started."));
                    hold.replace(Supervisor::parked(logger, reason));
                    return;
                }
                match preflight::run(&logger, &held_runtime) {
                    preflight::Outcome::Ready => {
                        hold.replace(Supervisor::start(logger, &held_runtime))
                    }
                    preflight::Outcome::Parked(reason) => {
                        hold.replace(Supervisor::parked(logger, reason))
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the tray app could not be built")
        .run(|app, event| {
            // Quit from the menu already shut the supervisor down; this catches
            // the event-loop exits — and `watch_exit_signals` catches the
            // signals, which never reach this handler. ~~no exit path leaves an
            // orphaned worker~~ Corrected 2026-08-27, the day it was written:
            // a SIGTERM proved otherwise, and the sigwait thread above is the
            // fix. A SIGKILL still orphans, which is what the worker's lease
            // sweep exists to absorb.
            if let tauri::RunEvent::Exit = event {
                app.state::<Arc<RuntimeHold>>().shutdown();
            }
        });
}
