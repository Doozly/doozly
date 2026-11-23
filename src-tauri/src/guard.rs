//! The window only ever shows our own pages. A link to the web opens in the browser, so no
//! remote page runs in the webview, even one dropped onto the window.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, Url};
use tauri_plugin_opener::OpenerExt;

/// The bundled app: tauri://localhost on Linux and macOS, http://tauri.localhost on Windows.
/// The dev server too in debug builds.
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "blob" => true,
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || (cfg!(debug_assertions)
                    && url.host_str() == Some("localhost")
                    && url.port() == Some(5173))
        }
        _ => false,
    }
}

/// What the browser may have, the rest is dropped
fn for_the_browser(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "http" | "mailto")
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("guard")
        .on_navigation(|webview, url| {
            if is_app_url(url) {
                return true;
            }
            if for_the_browser(url) {
                let _ = webview.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn only_our_own_pages_load_in_the_window() {
        assert!(is_app_url(&url("tauri://localhost/lists/inbox")));
        assert!(is_app_url(&url("http://tauri.localhost/lists/inbox")));
        assert!(is_app_url(&url("about:blank")));
        assert!(!is_app_url(&url("https://doozly.app/privacy")));
        assert!(!is_app_url(&url("https://tauri.localhost.evil.example/")));
        assert!(!is_app_url(&url("file:///etc/passwd")));
        assert!(!is_app_url(&url("http://localhost:8080/")));
    }

    #[test]
    fn only_web_and_mail_links_go_to_the_browser() {
        assert!(for_the_browser(&url("https://github.com/Doozly/doozly")));
        assert!(for_the_browser(&url("mailto:support@doozly.app")));
        assert!(!for_the_browser(&url("file:///etc/passwd")));
        assert!(!for_the_browser(&url("smb://server/share")));
    }
}
