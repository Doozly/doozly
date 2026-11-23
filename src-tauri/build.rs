use std::{env, fs};

// Client IDs for desktop sign-in, from the environment (CI) or ../.env.local (dev). Missing is fine, then that provider says so.
const SIGN_IN_KEYS: [&str; 4] = [
    "VITE_MICROSOFT_CLIENT_ID",
    "VITE_DROPBOX_CLIENT_ID",
    "GOOGLE_DESKTOP_CLIENT_ID",
    "GOOGLE_DESKTOP_CLIENT_SECRET",
];

fn sign_in_config() {
    println!("cargo:rerun-if-changed=../.env.local");
    let local = fs::read_to_string("../.env.local").unwrap_or_default();
    for key in SIGN_IN_KEYS {
        println!("cargo:rerun-if-env-changed={key}");
        let from_file = local.lines().find_map(|line| {
            let (k, v) = line.split_once('=')?;
            (k.trim() == key).then(|| v.trim().to_string())
        });
        if let Some(value) = env::var(key).ok().or(from_file).filter(|v| !v.is_empty()) {
            println!("cargo:rustc-env=DOOZLY_{key}={value}");
        }
    }
}

fn main() {
    sign_in_config();
    // Listing our commands makes each one need a permission, like the core ones
    let manifest = tauri_build::AppManifest::new().commands(&[
        "set_reminders",
        "desktop_settings",
        "set_close_to_tray",
        "set_open_at_login",
        "set_quick_add",
        "close_quick_add",
        "update_ready",
        "install_update",
        "sign_in",
        "access_token",
        "drop_access_token",
        "restored_account",
        "sign_out",
        // Only a --features smoke build grants it, at runtime (src/smoke.rs)
        "smoke_report",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("tauri-build failed");
}
