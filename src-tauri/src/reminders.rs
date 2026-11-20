use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// One reminder as the SPA hands it over. The id changes when the time does.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: String,
    /// Epoch ms
    pub fire_at: i64,
    pub title: String,
    /// The list's name
    pub body: String,
    /// Where a click goes, like /lists/inbox/tasks/abc
    pub path: String,
}

/// The wanted set plus what has gone out already. Saved, so a restart doesn't repeat any.
#[derive(Default, Debug, Serialize, Deserialize)]
pub struct Schedule {
    reminders: Vec<Reminder>,
    fired: HashSet<String>,
}

/// Missed by more than this (the app was off, say), a reminder is dropped instead of shown
pub const GRACE_MS: i64 = 24 * 60 * 60 * 1000;
/// Wake at least this often, so sleep and clock changes can't push a reminder far out
pub const MAX_SLEEP: Duration = Duration::from_secs(30);

impl Schedule {
    /// Takes the full set. A new reminder that's already due never fires: it was set in the past.
    pub fn replace(&mut self, reminders: Vec<Reminder>, now: i64) {
        let known: HashSet<&str> = self.reminders.iter().map(|r| r.id.as_str()).collect();
        let late: Vec<String> = reminders
            .iter()
            .filter(|r| r.fire_at <= now && !known.contains(r.id.as_str()))
            .map(|r| r.id.clone())
            .collect();
        let ids: HashSet<&str> = reminders.iter().map(|r| r.id.as_str()).collect();
        self.fired.retain(|id| ids.contains(id.as_str()));
        self.fired.extend(late);
        self.reminders = reminders;
    }

    /// What's due now. Each comes out once.
    pub fn due(&mut self, now: i64) -> Vec<Reminder> {
        let mut out = Vec::new();
        for r in &self.reminders {
            if r.fire_at > now || self.fired.contains(&r.id) {
                continue;
            }
            self.fired.insert(r.id.clone());
            if now - r.fire_at <= GRACE_MS {
                out.push(r.clone());
            }
        }
        out
    }

    /// How long until the next one, at most MAX_SLEEP
    pub fn sleep_for(&self, now: i64) -> Duration {
        self.reminders
            .iter()
            .filter(|r| !self.fired.contains(&r.id))
            .map(|r| Duration::from_millis((r.fire_at - now).max(0) as u64))
            .min()
            .unwrap_or(MAX_SLEEP)
            .min(MAX_SLEEP)
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// The schedule shared between the command and the timer thread, kept in a file
pub struct Scheduler {
    file: PathBuf,
    schedule: Mutex<Schedule>,
    changed: Condvar,
}

impl Scheduler {
    pub fn load(file: PathBuf) -> Arc<Self> {
        // A broken or missing file just means starting empty, the SPA sends the set again on load
        let schedule = fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Arc::new(Self {
            file,
            schedule: Mutex::new(schedule),
            changed: Condvar::new(),
        })
    }

    pub fn replace(&self, reminders: Vec<Reminder>) {
        let mut s = self.schedule.lock().unwrap();
        s.replace(reminders, now_ms());
        self.save(&s);
        self.changed.notify_all();
    }

    fn save(&self, s: &Schedule) {
        if let Some(dir) = self.file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_vec(s) {
            let _ = fs::write(&self.file, json);
        }
    }

    /// Runs forever: waits for the next reminder or a new set, then hands out what's due
    pub fn run(&self, show: impl Fn(Reminder)) {
        let mut s = self.schedule.lock().unwrap();
        loop {
            let due = s.due(now_ms());
            if !due.is_empty() {
                self.save(&s);
            }
            for r in due {
                show(r);
            }
            let wait = s.sleep_for(now_ms());
            s = self.changed.wait_timeout(s, wait).unwrap().0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(id: &str, fire_at: i64) -> Reminder {
        Reminder {
            id: id.into(),
            fire_at,
            title: id.into(),
            body: "Tasks".into(),
            path: format!("/lists/inbox/tasks/{id}"),
        }
    }

    fn ids(rs: Vec<Reminder>) -> Vec<String> {
        rs.into_iter().map(|r| r.id).collect()
    }

    #[test]
    fn fires_each_once_when_due() {
        let mut s = Schedule::default();
        s.replace(vec![at("a", 1_000), at("b", 2_000)], 0);
        assert!(s.due(999).is_empty());
        assert_eq!(ids(s.due(1_500)), ["a"]);
        assert!(s.due(1_600).is_empty());
        assert_eq!(ids(s.due(5_000)), ["b"]);
    }

    #[test]
    fn a_reminder_set_in_the_past_never_fires() {
        let mut s = Schedule::default();
        s.replace(vec![at("old", 1_000)], 5_000);
        assert!(s.due(5_000).is_empty());
    }

    #[test]
    fn sending_the_same_set_again_repeats_nothing() {
        let mut s = Schedule::default();
        s.replace(vec![at("a", 1_000)], 0);
        assert_eq!(ids(s.due(1_000)), ["a"]);
        s.replace(vec![at("a", 1_000)], 2_000);
        assert!(s.due(3_000).is_empty());
    }

    #[test]
    fn a_known_reminder_slept_through_still_fires() {
        let mut s = Schedule::default();
        s.replace(vec![at("a", 1_000)], 0);
        // The laptop slept past it and the set came again on waking
        s.replace(vec![at("a", 1_000)], 60_000);
        assert_eq!(ids(s.due(60_000)), ["a"]);
    }

    #[test]
    fn one_missed_by_more_than_a_day_is_dropped() {
        let mut s = Schedule::default();
        s.replace(vec![at("a", 1_000)], 0);
        assert!(s.due(1_000 + GRACE_MS + 1).is_empty());
        assert_eq!(s.sleep_for(1_000 + GRACE_MS + 2), MAX_SLEEP);
    }

    #[test]
    fn removed_reminders_are_forgotten() {
        let mut s = Schedule::default();
        s.replace(vec![at("a", 1_000)], 0);
        s.due(1_000);
        s.replace(vec![], 2_000);
        assert!(s.fired.is_empty());
    }

    #[test]
    fn sleeps_until_the_next_but_never_long() {
        let mut s = Schedule::default();
        assert_eq!(s.sleep_for(0), MAX_SLEEP);
        s.replace(vec![at("a", 5_000)], 0);
        assert_eq!(s.sleep_for(1_000), Duration::from_secs(4));
        s.replace(vec![at("a", 5_000_000)], 0);
        assert_eq!(s.sleep_for(0), MAX_SLEEP);
    }

    #[test]
    fn survives_a_restart_through_the_file() {
        let dir = std::env::temp_dir().join(format!("doozly-test-{}", now_ms()));
        let file = dir.join("reminders.json");
        let first = Scheduler::load(file.clone());
        first.replace(vec![at("a", now_ms() + 60_000)]);
        let again = Scheduler::load(file);
        assert_eq!(ids(again.schedule.lock().unwrap().reminders.clone()), ["a"]);
        let _ = fs::remove_dir_all(dir);
    }
}
