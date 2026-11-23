use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Like the web app's service worker, it looks again now and then, Doozly may run for weeks
const EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// Not in the middle of starting up
const FIRST: Duration = Duration::from_secs(30);

/// A downloaded update, waiting for the user to restart
#[derive(Default)]
pub struct Pending(Mutex<Option<(Update, Vec<u8>)>>);

/// `allowed` is false when an admin's policy leaves updates to the organisation
pub fn start(app: &AppHandle, allowed: bool) {
    app.manage(Pending::default());
    // A dev build has nothing to update to
    if cfg!(debug_assertions) || !allowed {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(FIRST);
        loop {
            if let Err(e) = tauri::async_runtime::block_on(fetch(&app)) {
                eprintln!("Update check: {e}");
            }
            thread::sleep(EVERY);
        }
    });
}

async fn fetch(app: &AppHandle) -> tauri_plugin_updater::Result<()> {
    let pending = app.state::<Pending>();
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    let have = pending
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|(u, _)| u.version.clone());
    if have.as_deref() == Some(update.version.as_str()) {
        return Ok(());
    }
    let bytes = update.download(|_, _| {}, || {}).await?;
    let version = update.version.clone();
    *pending.0.lock().unwrap() = Some((update, bytes));
    let _ = app.emit_to("main", "doozly:update", version);
    Ok(())
}

/// The version that's downloaded and ready, for a window that missed the event
#[tauri::command]
pub fn update_ready(pending: State<'_, Pending>) -> Option<String> {
    pending
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|(u, _)| u.version.clone())
}

/// Installs it and starts the new version. On Windows the installer quits Doozly itself.
#[tauri::command]
pub fn install_update(app: AppHandle, pending: State<'_, Pending>) -> Result<(), String> {
    let Some((update, bytes)) = pending.0.lock().unwrap().take() else {
        return Ok(());
    };
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart()
}
