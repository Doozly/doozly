import { useEffect, useState } from "react";
import { Switch } from "react-aria-components";
import { isDesktop, isMac, loadTauri } from "../../platform.ts";
import data from "../account/DataSection.module.css";
import styles from "../SettingsPanel.module.css";

interface Prefs {
  closeToTray: boolean;
  openAtLogin: boolean;
  quickAdd: boolean;
}

interface Shown extends Prefs {
  /** GNOME has no tray without the AppIndicator extension */
  hasTray: boolean;
}

const commands = {
  closeToTray: "set_close_to_tray",
  openAtLogin: "set_open_at_login",
  quickAdd: "set_quick_add",
} as const;

const labels: Record<keyof Prefs, string> = {
  closeToTray: "Keep running in the tray when closed",
  openAtLogin: "Open Doozly when you log in",
  quickAdd: `Add a task from anywhere with ${isMac() ? "⌥⌘N" : "Ctrl+Alt+N"}`,
};

/** Settings → Desktop. Per computer, so it lives on the Rust side and never syncs. */
export function DesktopSection() {
  const [prefs, setPrefs] = useState<Shown | null>(null);

  useEffect(() => {
    if (!isDesktop()) return;
    let gone = false;
    void loadTauri()
      .then(({ invoke }) => invoke<Shown>("desktop_settings"))
      .then((p) => {
        if (!gone) setPrefs(p);
      });
    return () => {
      gone = true;
    };
  }, []);

  if (!prefs) return null;

  const change = async (key: keyof Prefs, on: boolean) => {
    setPrefs((p) => p && { ...p, [key]: on });
    const { invoke } = await loadTauri();
    try {
      await invoke(commands[key], { on });
    } catch {
      // The system said no (no autostart folder, keys taken by another app), also the switch goes back
      setPrefs((p) => p && { ...p, [key]: !on });
    }
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Desktop</h3>
      {(Object.keys(labels) as (keyof Prefs)[]).map((key) => (
        <Switch
          key={key}
          className={styles.switch}
          isSelected={prefs[key]}
          onChange={(on) => void change(key, on)}
        >
          <span className={styles.switchLabel}>{labels[key]}</span>
          <span className={styles.track} aria-hidden>
            <span className={styles.thumb} />
          </span>
        </Switch>
      ))}
      {!prefs.hasTray && prefs.closeToTray && (
        <p className={data.text}>
          Your desktop doesn't show tray icons, so closing Doozly minimises it
          instead.
        </p>
      )}
    </section>
  );
}
