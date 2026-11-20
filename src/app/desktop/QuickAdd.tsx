import { useEffect, useRef, useState } from "react";
import { INBOX_ID } from "../../data/model.ts";
import { useActions, useAppState } from "../../state/AppContext.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { useThemeSync } from "../theme.ts";
import styles from "./QuickAdd.module.css";

interface QuickAddProps {
  /** Puts the box away, done or not */
  onClose: () => void;
}

/** The desktop app's quick add box, from the global shortcut. Adds to Tasks, like a new task anywhere. */
export function QuickAdd({ onClose }: QuickAddProps) {
  useThemeSync();
  const inbox = useAppState((s) => s.lists[INBOX_ID]);
  const { addTask } = useActions();
  const [title, setTitle] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // The window is kept and shown again, so each time it comes back the cursor goes in
  useEffect(() => {
    const focus = () => input.current?.focus();
    focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);

  return (
    <form
      className={styles.box}
      data-accent={inbox?.accent ?? "teal"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        addTask(INBOX_ID, title);
        setTitle("");
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setTitle("");
          onClose();
        }
      }}
    >
      <Icon name="add" className={styles.icon} />
      <input
        ref={input}
        className={styles.input}
        aria-label="Add a task"
        placeholder="Add a task"
        value={title}
        maxLength={255}
        onChange={(e) => setTitle(e.target.value)}
      />
      <span className={styles.where}>{inbox?.title ?? "Tasks"}</span>
    </form>
  );
}
