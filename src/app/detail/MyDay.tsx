import { Button } from "react-aria-components";
import { inMyDay } from "../../data/localDate.ts";
import type { Task } from "../../data/model.ts";
import { useActions } from "../../state/AppContext.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { useToday } from "../../ui/useToday.ts";
// Same look as the due date row
import styles from "./DueDate.module.css";

export function MyDay({ task }: { task: Task }) {
  const { toggleMyDay } = useActions();
  const added = inMyDay(task, useToday());

  return (
    <div className={styles.row} data-set={added || undefined}>
      <Button
        className={styles.button}
        aria-pressed={added}
        onPress={() => {
          if (!added) toggleMyDay(task.id);
        }}
      >
        <Icon name="myDay" />
        {added ? "Added to My Day" : "Add to My Day"}
      </Button>
      {added && (
        <IconButton
          icon="close"
          label="Remove from My Day"
          className={styles.remove}
          onPress={() => toggleMyDay(task.id)}
        />
      )}
    </div>
  );
}
