import { formatDue } from "../../data/localDate.ts";
import { useActions, useAppState } from "../../state/AppContext.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { SidePanel } from "../../ui/SidePanel.tsx";
import { useToday } from "../../ui/useToday.ts";
import styles from "./SuggestionsPanel.module.css";
import { suggestions } from "./suggestions.ts";

interface SuggestionsPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SuggestionsPanel({
  isOpen,
  onOpenChange,
}: SuggestionsPanelProps) {
  const now = useToday();
  // Groups are new objects every time, so select the stable map and work them out here
  const tasks = useAppState((s) => s.tasks);
  const groups = suggestions(Object.values(tasks), now);
  const lists = useAppState((s) => s.lists);
  const { toggleMyDay } = useActions();

  return (
    <SidePanel
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Suggestions"
      closeLabel="Close suggestions"
    >
      <div className={styles.body}>
        {groups.length === 0 && (
          <p className={styles.empty}>
            Nothing to suggest right now. Overdue and upcoming tasks show up
            here.
          </p>
        )}
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className={styles.groupTitle}>{group.title}</h3>
            <ul className={styles.list} aria-label={group.title}>
              {group.tasks.map((task) => (
                <li key={task.id} className={styles.row}>
                  <div className={styles.text}>
                    <span className={styles.title}>{task.title}</span>
                    <span className={styles.meta}>
                      {lists[task.listId]?.title}
                      {task.dueDate && ` · ${formatDue(task.dueDate, now)}`}
                    </span>
                  </div>
                  <IconButton
                    icon="add"
                    label={`Add ${task.title} to My Day`}
                    onPress={() => toggleMyDay(task.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </SidePanel>
  );
}
