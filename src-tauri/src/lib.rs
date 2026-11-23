mod auth;
mod desktop;
mod guard;
mod policy;
mod quick;
mod reminders;
mod smoke;
mod update;

use std::sync::Arc;
use std::thread;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::StateFlags;

use reminders::{Reminder, Scheduler};

/// Passed when the system starts Doozly at login, so it waits in the tray
const HIDDEN: &str = "--hidden";

/// The SPA's whole reminder set, sent again whenever it changes
#[tauri::command]
fn set_reminders(scheduler: State<'_, Arc<Scheduler>>, reminders: Vec<Reminder>) {
    scheduler.replace(reminders);
}

fn notify(app: &AppHandle, r: Reminder) {
    let app = app.clone();
    // Each notification waits for its click on its own thread
    thread::spawn(move || {
        let shown = notify_rust::Notification::new()
            .appname("Doozly")
            .summary(&r.title)
            .body(&r.body)
            .action("default", "Open")
            .show();
        let Ok(handle) = shown else { return };
        handle.wait_for_action(|action| {
            if action != "__closed" {
                open(&app, &r.path);
            }
        });
    });
}

/// Brings the window back and opens the task in it
fn open(app: &AppHandle, path: &str) {
    desktop::show(app);
    // Only paths inside the app, never a URL
    if path.starts_with('/') && !path.starts_with("//") {
        let _ = app.emit_to("main", "doozly:open", path);
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        // First, so a second launch only brings the running one forward
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop::show(app)
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN]),
        ))
        // Size, position and maximised state come back as they were left. Not whether it was
        // shown: after quitting from the tray it would stay hidden for good.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .with_denylist(&["quick"])
                .build(),
        )
        .plugin(quick::plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(guard::plugin());
    let app = smoke::add(builder)
        .manage(auth::Auth::new(Arc::new(auth::Keychain::default())))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            set_reminders,
            desktop::desktop_settings,
            desktop::set_close_to_tray,
            desktop::set_open_at_login,
            desktop::set_quick_add,
            quick::close_quick_add,
            update::update_ready,
            update::install_update,
            auth::sign_in,
            auth::access_token,
            auth::drop_access_token,
            auth::restored_account,
            auth::sign_out,
            smoke::smoke_report,
        ])
        .on_window_event(|window, event| {
            desktop::on_window_event(window, event);
            quick::on_window_event(window, event);
        })
        .on_menu_event(|app, event| desktop::on_menu_event(app, event.id().as_ref()))
        .setup(|app| {
            let config = app.path().app_config_dir()?;
            let policy = policy::load();
            let (settings, first) = desktop::Settings::load(config.join("desktop.json"), &policy);
            if let (true, Some(on)) = (first, policy.open_at_login) {
                let _ = desktop::set_open_at_login(app.handle().clone(), on);
            }
            if settings.get().quick_add {
                // Taken by another app already: then Settings just shows it as off
                if let Err(e) = quick::set_enabled(app.handle(), true) {
                    eprintln!("Quick add shortcut {}: {e}", quick::SHORTCUT);
                }
            }
            app.manage(settings);
            desktop::tray(app)?;
            let bar = desktop::menu_bar(app.handle())?;
            if cfg!(target_os = "macos") {
                app.set_menu(bar)?;
            }

            let file = app.path().app_data_dir()?.join("reminders.json");
            let scheduler = Scheduler::load(file);
            app.manage(scheduler.clone());
            let handle = app.handle().clone();
            thread::spawn(move || scheduler.run(|r| notify(&handle, r)));
            update::start(app.handle(), policy.updates());

            if !std::env::args().any(|a| a == HIDDEN) {
                desktop::show(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Doozly couldn't start");

    app.run(|_app, _event| {
        // The Dock icon on macOS, clicked while the window is hidden
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            desktop::show(_app);
        }
    });
}
