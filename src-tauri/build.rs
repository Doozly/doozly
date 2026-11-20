fn main() {
    // Listing our commands makes each one need a permission, like the core ones
    let manifest = tauri_build::AppManifest::new().commands(&[
        "set_reminders",
        "desktop_settings",
        "set_close_to_tray",
        "set_open_at_login",
        "set_quick_add",
        "close_quick_add",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("tauri-build failed");
}
