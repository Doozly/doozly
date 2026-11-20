use tauri::plugin::TauriPlugin;
use tauri::{
    AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent, Wry,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// From anywhere, a small box that adds a task to Tasks
pub const SHORTCUT: &str = "CommandOrControl+Alt+N";
const LABEL: &str = "quick";

pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle(app);
            }
        })
        .build()
}

pub fn set_enabled(app: &AppHandle, on: bool) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    let done = match (on, shortcuts.is_registered(SHORTCUT)) {
        (true, false) => shortcuts.register(SHORTCUT),
        (false, true) => shortcuts.unregister(SHORTCUT),
        _ => Ok(()),
    };
    done.map_err(|e| e.to_string())
}

pub fn enabled(app: &AppHandle) -> bool {
    app.global_shortcut().is_registered(SHORTCUT)
}

fn toggle(app: &AppHandle) {
    match app.get_webview_window(LABEL) {
        Some(w) if w.is_visible().unwrap_or(false) => {
            let _ = w.hide();
        }
        Some(w) => show(&w),
        // Made on first use: most people never press it, and each window is a webview
        None => {
            let made = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("quick-add".into()))
                .title("Add a task")
                .inner_size(560.0, 64.0)
                .resizable(false)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .center()
                .build();
            match made {
                Ok(w) => show(&w),
                Err(e) => eprintln!("Quick add window: {e}"),
            }
        }
    }
}

fn show(w: &WebviewWindow) {
    let _ = w.center();
    let _ = w.show();
    let _ = w.set_focus();
}

/// The box is done: added, or Escape
#[tauri::command]
pub fn close_quick_add(window: Window) {
    if window.label() == LABEL {
        let _ = window.hide();
    }
}

/// Clicking anywhere else puts it away, like a menu
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() == LABEL && matches!(event, WindowEvent::Focused(false)) {
        let _ = window.hide();
    }
}
