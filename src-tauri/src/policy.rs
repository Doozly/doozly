//! Machine-wide settings an IT admin can roll out with the installer. Only defaults for the
//! first start, people can change them after. Except the updater: switched off, it stays off.

use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

#[derive(Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Policy {
    /// false: no update checks, the organisation's own tooling updates Doozly
    pub updates: Option<bool>,
    pub close_to_tray: Option<bool>,
    pub open_at_login: Option<bool>,
    pub quick_add: Option<bool>,
}

impl Policy {
    pub fn updates(&self) -> bool {
        self.updates != Some(false)
    }
}

/// Where admins put it: /etc/doozly, /Library/Application Support/Doozly, %ProgramData%\Doozly
pub fn path() -> PathBuf {
    if cfg!(windows) {
        let data = std::env::var_os("PROGRAMDATA").unwrap_or_else(|| "C:\\ProgramData".into());
        PathBuf::from(data).join("Doozly").join("policy.json")
    } else if cfg!(target_os = "macos") {
        PathBuf::from("/Library/Application Support/Doozly/policy.json")
    } else {
        PathBuf::from("/etc/doozly/policy.json")
    }
}

/// No file is the normal case. A broken one is ignored too, with a note, rather than not starting.
pub fn load() -> Policy {
    let file = path();
    let Ok(bytes) = fs::read(&file) else {
        return Policy::default();
    };
    parse(&bytes).unwrap_or_else(|e| {
        eprintln!("doozly: ignoring {}: {e}", file.display());
        Policy::default()
    })
}

fn parse(bytes: &[u8]) -> Result<Policy, serde_json::Error> {
    serde_json::from_slice(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_admins_write() {
        let p = parse(br#"{"updates": false, "openAtLogin": true, "closeToTray": true}"#).unwrap();
        assert!(!p.updates());
        assert_eq!(p.open_at_login, Some(true));
        assert_eq!(p.close_to_tray, Some(true));
        assert_eq!(p.quick_add, None);
    }

    #[test]
    fn updates_stay_on_unless_switched_off() {
        assert!(Policy::default().updates());
        assert!(parse(br#"{"updates": true}"#).unwrap().updates());
        // Unknown keys from a newer version don't break it
        assert!(parse(br#"{"somethingNew": 1}"#).unwrap().updates());
        assert!(parse(b"not json").is_err());
    }
}
