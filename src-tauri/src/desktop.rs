use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, State, Window, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

use crate::policy::Policy;
use crate::quick;

/// Per-device settings that only make sense on desktop, so they never sync
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    /// Closing the window keeps Doozly running in the tray, so reminders still come. Off unless chosen.
    pub close_to_tray: bool,
    /// The global shortcut for the quick add box
    pub quick_add: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            close_to_tray: false,
            quick_add: true,
        }
    }
}

pub struct Settings {
    file: PathBuf,
    prefs: Mutex<Prefs>,
}

impl Settings {
    /// From the file. On the first start the defaults with the admin's policy on top, saved
    /// right away so that only happens once. true when it was the first start.
    pub fn load(file: PathBuf, policy: &Policy) -> (Self, bool) {
        let saved: Option<Prefs> = fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok());
        let first = saved.is_none();
        let prefs = saved.unwrap_or_else(|| {
            let d = Prefs::default();
            Prefs {
                close_to_tray: policy.close_to_tray.unwrap_or(d.close_to_tray),
                quick_add: policy.quick_add.unwrap_or(d.quick_add),
            }
        });
        let settings = Self {
            file,
            prefs: Mutex::new(prefs),
        };
        if first {
            settings.update(|_| {});
        }
        (settings, first)
    }

    pub fn get(&self) -> Prefs {
        self.prefs.lock().unwrap().clone()
    }

    fn update(&self, change: impl FnOnce(&mut Prefs)) {
        let mut prefs = self.prefs.lock().unwrap();
        change(&mut prefs);
        if let Some(dir) = self.file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_vec(&*prefs) {
            let _ = fs::write(&self.file, json);
        }
    }
}

/// Whether the desktop shows tray icons at all. GNOME doesn't, unless the AppIndicator extension is on.
#[cfg(target_os = "linux")]
fn tray_shown() -> bool {
    zbus::block_on(async {
        let conn = zbus::Connection::session().await.ok()?;
        let dbus = zbus::fdo::DBusProxy::new(&conn).await.ok()?;
        let name = "org.kde.StatusNotifierWatcher".try_into().ok()?;
        dbus.name_has_owner(name).await.ok()
    })
    .unwrap_or(false)
}

#[cfg(not(target_os = "linux"))]
fn tray_shown() -> bool {
    true
}

/// What Settings → Desktop shows
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettings {
    close_to_tray: bool,
    open_at_login: bool,
    /// Without one, closing minimises instead of hiding
    has_tray: bool,
    /// On and really registered: another app may hold the keys already
    quick_add: bool,
}

#[tauri::command]
pub fn desktop_settings(app: AppHandle, settings: State<'_, Settings>) -> DesktopSettings {
    DesktopSettings {
        close_to_tray: settings.get().close_to_tray,
        open_at_login: app.autolaunch().is_enabled().unwrap_or(false),
        has_tray: tray_shown(),
        quick_add: quick::enabled(&app),
    }
}

#[tauri::command]
pub fn set_quick_add(
    app: AppHandle,
    settings: State<'_, Settings>,
    on: bool,
) -> Result<(), String> {
    quick::set_enabled(&app, on)?;
    settings.update(|p| p.quick_add = on);
    Ok(())
}

#[tauri::command]
pub fn set_close_to_tray(settings: State<'_, Settings>, on: bool) {
    settings.update(|p| p.close_to_tray = on);
}

#[tauri::command]
pub fn set_open_at_login(app: AppHandle, on: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let done = if on {
        launcher.enable()
    } else {
        launcher.disable()
    };
    done.map_err(|e| e.to_string())
}

/// Brings the main window back from the tray, the taskbar or behind other windows
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // GNOME won't un-minimise for a request without a user timestamp (a second
        // launch, a notification). Mapping the window again does bring it back.
        if cfg!(target_os = "linux") && window.is_minimized().unwrap_or(false) {
            let _ = window.hide();
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Runs one of the SPA's shortcut actions, like "newTask"
pub fn shortcut(app: &AppHandle, action: &str) {
    show(app);
    let _ = app.emit_to("main", "doozly:shortcut", action);
}

pub fn tray(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Doozly", true, None::<&str>)?;
    let add = MenuItem::with_id(app, "add", "Add a task", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Doozly", true, None::<&str>)?;
    let line = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &add, &line, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Doozly")
        .menu(&menu)
        // A left click opens the window, the menu is on the right button
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "add" => shortcut(app, "newTask"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// The menu bar. Only macOS gets one: To Do on Windows has none, and there Ctrl keys come from the SPA.
pub fn menu_bar(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let action = |id: &str, label: &str, keys: &str| {
        MenuItem::with_id(app, format!("action:{id}"), label, true, Some(keys))
    };
    let sep = || PredefinedMenuItem::separator(app);
    let doozly = Submenu::with_items(
        app,
        "Doozly",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Doozly"), None)?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    // Without these, copy and paste don't work in the webview on macOS
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let task = Submenu::with_items(
        app,
        "Task",
        true,
        &[
            &action("newTask", "Add a Task", "CmdOrCtrl+N")?,
            &action("newList", "New List", "CmdOrCtrl+L")?,
            &sep()?,
            &action("myDay", "Add to My Day", "CmdOrCtrl+T")?,
            &action("complete", "Complete", "CmdOrCtrl+D")?,
            &sep()?,
            &action("search", "Search", "CmdOrCtrl+F")?,
            &action("sync", "Sync", "CmdOrCtrl+R")?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &action("sidebar", "Show or Hide Sidebar", "CmdOrCtrl+1")?,
            &MenuItem::with_id(app, "action:help", "Keyboard Shortcuts", true, None::<&str>)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&doozly, &edit, &task, &view, &window])
}

/// A menu item that stands for one of the SPA's shortcut actions
pub fn on_menu_event(app: &AppHandle, id: &str) {
    if let Some(action) = id.strip_prefix("action:") {
        shortcut(app, action);
    }
}

/// Closing the main window quits Doozly, or hides it when it should live in the tray
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != "main" {
            return;
        }
        let settings = window.app_handle().state::<Settings>();
        if !settings.get().close_to_tray {
            // A hidden quick add window would keep it running otherwise
            window.app_handle().exit(0);
            return;
        }
        api.prevent_close();
        // With no tray to come back from, a hidden window would be lost
        let _ = if tray_shown() {
            window.hide()
        } else {
            window.minimize()
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quits_on_close_unless_told_otherwise() {
        let dir = std::env::temp_dir().join(format!("doozly-prefs-{}", std::process::id()));
        let file = dir.join("desktop.json");
        let none = Policy::default();
        let load = |p: &Policy| Settings::load(file.clone(), p);
        let (first, is_first) = load(&none);
        assert!(is_first && !first.get().close_to_tray);
        first.update(|p| p.close_to_tray = true);
        let (again, is_first) = load(&none);
        assert!(!is_first && again.get().close_to_tray);
        // An unknown or missing field keeps its default
        fs::write(&file, "{}").unwrap();
        assert!(!load(&none).0.get().close_to_tray);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_admin_policy_only_sets_the_first_start() {
        let dir = std::env::temp_dir().join(format!("doozly-policy-{}", std::process::id()));
        let file = dir.join("desktop.json");
        let policy = Policy {
            close_to_tray: Some(true),
            quick_add: Some(false),
            ..Policy::default()
        };
        let (first, _) = Settings::load(file.clone(), &policy);
        assert!(first.get().close_to_tray && !first.get().quick_add);
        first.update(|p| p.close_to_tray = false);
        // The user's choice wins from then on
        assert!(!Settings::load(file, &policy).0.get().close_to_tray);
        let _ = fs::remove_dir_all(dir);
    }
}
