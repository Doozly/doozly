import { useState } from "react";
import {
  Button,
  Label,
  Radio,
  RadioGroup,
  Switch,
} from "react-aria-components";
import type { Settings } from "../data/model.ts";
import { useActions, useAppState } from "../state/AppContext.tsx";
import { setting } from "../state/actions.ts";
import { SidePanel } from "../ui/SidePanel.tsx";
import { DataSection } from "./account/DataSection.tsx";
import { DesktopSection } from "./desktop/DesktopSection.tsx";
import { InstallSection } from "./pwa/InstallSection.tsx";
import { PushSection } from "./reminders/PushSection.tsx";
import styles from "./SettingsPanel.module.css";
import { ShortcutHelp } from "./shortcuts/ShortcutHelp.tsx";

type Toggle = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

const toggles: { key: Toggle; label: string }[] = [
  { key: "confirmBeforeDelete", label: "Confirm before deleting" },
  { key: "addNewTasksOnTop", label: "Add new tasks on top" },
  { key: "moveStarredToTop", label: "Move starred tasks to top" },
  { key: "playCompletionSound", label: "Play completion sound" },
];

const themes: { value: Settings["theme"]; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Use system setting" },
];

interface SettingsPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsPanel({ isOpen, onOpenChange }: SettingsPanelProps) {
  return (
    <SidePanel
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Settings"
      closeLabel="Close settings"
    >
      <SettingsForm />
    </SidePanel>
  );
}

function SettingsForm() {
  const settings = useAppState((s) => s.settings);
  const { setSetting } = useActions();
  const [help, setHelp] = useState(false);
  const current = <K extends keyof Settings>(key: K) =>
    setting({ settings }, key);

  return (
    <div className={styles.body}>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>General</h3>
        {toggles.map(({ key, label }) => (
          <Switch
            key={key}
            className={styles.switch}
            isSelected={current(key)}
            onChange={(on) => setSetting(key, on)}
          >
            <span className={styles.switchLabel}>{label}</span>
            <span className={styles.track} aria-hidden>
              <span className={styles.thumb} />
            </span>
          </Switch>
        ))}
      </section>

      <RadioGroup
        className={styles.section}
        value={current("theme")}
        onChange={(v) => setSetting("theme", v as Settings["theme"])}
      >
        <Label className={styles.sectionTitle}>Theme</Label>
        {themes.map(({ value, label }) => (
          <Radio key={value} value={value} className={styles.radio}>
            <span className={styles.dot} aria-hidden />
            {label}
          </Radio>
        ))}
      </RadioGroup>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Keyboard</h3>
        <Switch
          className={styles.switch}
          isSelected={current("keyboardShortcuts")}
          onChange={(on) => setSetting("keyboardShortcuts", on)}
        >
          <span className={styles.switchLabel}>Single-key shortcuts</span>
          <span className={styles.track} aria-hidden>
            <span className={styles.thumb} />
          </span>
        </Switch>
        <Button className={styles.link} onPress={() => setHelp(true)}>
          Show keyboard shortcuts
        </Button>
        {/* Its own, inside the panel: one from the shell would sit outside the panel's
            focus trap, which then pulls the focus back from it */}
        <ShortcutHelp isOpen={help} onClose={() => setHelp(false)} />
      </section>

      <PushSection />

      <DesktopSection />

      <InstallSection />

      <DataSection />
    </div>
  );
}
