import {
  Dialog,
  Heading,
  Label,
  Modal,
  ModalOverlay,
  Radio,
  RadioGroup,
  Switch,
} from "react-aria-components";
import type { Settings } from "../data/model.ts";
import { useActions, useAppState } from "../state/AppContext.tsx";
import { setting } from "../state/actions.ts";
import { IconButton } from "../ui/IconButton.tsx";
import styles from "./SettingsPanel.module.css";

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
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className={styles.overlay}
    >
      <Modal className={styles.sheet}>
        <Dialog className={styles.dialog}>
          {({ close }) => (
            <>
              <div className={styles.top}>
                <Heading slot="title" className={styles.heading}>
                  Settings
                </Heading>
                <IconButton
                  icon="close"
                  label="Close settings"
                  onPress={close}
                />
              </div>
              <SettingsForm />
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function SettingsForm() {
  const settings = useAppState((s) => s.settings);
  const { setSetting } = useActions();
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
    </div>
  );
}
