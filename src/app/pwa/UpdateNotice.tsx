import { useState } from "react";
import { Button } from "react-aria-components";
import { useStore } from "zustand";
import { Icon } from "../../ui/Icon.tsx";
import { applyUpdate, installDesktopUpdate, updates } from "./serviceWorker.ts";
import styles from "./UpdateNotice.module.css";

/** Says when a new version is ready. Reloading is the user's call, they may be typing. */
export function UpdateNotice() {
  const worker = useStore(updates, (s) => s.waiting);
  const desktop = useStore(updates, (s) => s.desktop);
  const waiting = desktop ?? worker;
  const [later, setLater] = useState<ServiceWorker | string | null>(null);
  if (!waiting || waiting === later) return null;

  return (
    <div role="status" className={styles.card}>
      <Icon name="sync" className={styles.icon} />
      <span className={styles.text}>A new version of Doozly is ready.</span>
      <div className={styles.buttons}>
        <Button
          className={`${styles.button} ${styles.primary}`}
          onPress={desktop ? () => void installDesktopUpdate() : applyUpdate}
        >
          {desktop ? "Restart" : "Reload"}
        </Button>
        <Button className={styles.button} onPress={() => setLater(waiting)}>
          Later
        </Button>
      </div>
    </div>
  );
}
