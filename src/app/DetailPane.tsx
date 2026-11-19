import type { Task } from "../data/model.ts";
import { IconButton } from "../ui/IconButton.tsx";
import styles from "./DetailPane.module.css";

interface DetailPaneProps {
  task: Task;
  onClose: () => void;
}

export function DetailPane({ task, onClose }: DetailPaneProps) {
  return (
    <aside
      aria-label="Task details"
      className={styles.detail}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className={styles.top}>
        <IconButton icon="close" label="Close details" onPress={onClose} />
      </div>
      <h2 className={styles.title}>{task.title}</h2>
    </aside>
  );
}
