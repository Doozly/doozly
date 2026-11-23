//! A self-test for CI, built with `--features smoke`. The SPA runs its checks in the real
//! webview and reports here, and the exit code says how it went. It works the same on all
//! three systems, also where no WebDriver reaches the webview (WKWebView, WebView2 on CI).

use tauri::AppHandle;

/// The SPA's result. Every build has the command, but only a smoke build may call it.
#[tauri::command]
pub fn smoke_report(app: AppHandle, ok: bool, lines: Vec<String>) {
    #[cfg(feature = "smoke")]
    {
        for line in &lines {
            println!("smoke: {line}");
        }
        println!("smoke: {}", if ok { "PASSED" } else { "FAILED" });
        app.exit(if ok { 0 } else { 1 });
    }
    #[cfg(not(feature = "smoke"))]
    let _ = (app, ok, lines);
}

/// The self-test's plugin in a smoke build, nothing in any other
pub fn add<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    #[cfg(feature = "smoke")]
    return builder.plugin(plugin());
    #[cfg(not(feature = "smoke"))]
    builder
}

#[cfg(feature = "smoke")]
fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use std::time::Duration;
    use tauri::Manager;

    tauri::plugin::Builder::new("smoke")
        .js_init_script("window.__DOOZLY_SMOKE__ = true;")
        .setup(|app, _| {
            app.add_capability(
                r#"{"identifier": "smoke", "windows": ["main"], "permissions": ["allow-smoke-report"]}"#,
            )?;
            // A webview that never gets that far mustn't hang the CI job
            std::thread::spawn(|| {
                std::thread::sleep(Duration::from_secs(120));
                eprintln!("smoke: no report after 2 minutes");
                std::process::exit(3);
            });
            Ok(())
        })
        .build()
}
