import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { isDesktop, isMac } from "../../platform.ts";
import { useAppState } from "../../state/AppContext.tsx";
import { setting } from "../../state/actions.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { helpRows, NAVIGATION } from "./keys.ts";
import styles from "./ShortcutHelp.module.css";

interface ShortcutHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutHelp({ isOpen, onClose }: ShortcutHelpProps) {
  const enabled = useAppState((s) => setting(s, "keyboardShortcuts"));

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.overlay}
    >
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog}>
          <div className={styles.top}>
            <Heading slot="title" className={styles.title}>
              Keyboard shortcuts
            </Heading>
            <IconButton icon="close" label="Close" onPress={onClose} />
          </div>
          {!enabled && (
            <p className={styles.note}>
              Single-key shortcuts are turned off in Settings. Delete and the
              keys below still work.
            </p>
          )}
          <p className={styles.note}>
            {isDesktop()
              ? `The ${isMac() ? "⌘" : "Ctrl"} ones work anywhere, the single keys when you're not typing in a field.`
              : "They work when you're not typing in a field."}
          </p>
          <Keys rows={helpRows(isDesktop(), isMac())} label="Shortcuts" />
          <h3 className={styles.subtitle}>Moving around</h3>
          <Keys rows={NAVIGATION} label="Moving around" />
          <Button className={styles.done} onPress={onClose} autoFocus>
            Done
          </Button>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function Keys({
  rows,
  label,
}: {
  rows: { keys: string[]; label: string }[];
  label: string;
}) {
  return (
    <dl className={styles.keys} aria-label={label}>
      {rows.map((row) => (
        <div key={row.label} className={styles.row}>
          <dt className={styles.label}>{row.label}</dt>
          <dd className={styles.combo}>
            {row.keys.map((k, i) => (
              <span key={k}>
                {i > 0 && <span className={styles.or}> or </span>}
                <kbd className={styles.kbd}>{k}</kbd>
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
