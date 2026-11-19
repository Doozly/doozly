import { useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Step } from "../../data/model.ts";
import { useActions, useAppState } from "../../state/AppContext.tsx";
import { byPosition } from "../../state/position.ts";
import { Icon } from "../../ui/Icon.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { TaskCheck } from "../tasks/TaskCheck.tsx";
import styles from "./Steps.module.css";

export function Steps({ taskId }: { taskId: string }) {
  const steps = useAppState(
    useShallow((s) =>
      Object.values(s.steps)
        .filter((st) => st.taskId === taskId && st.deletedAt === null)
        .sort(byPosition),
    ),
  );
  const actions = useActions();

  // Alt+Up and Alt+Down shuffle a step, until drag and drop arrives
  const move = (index: number, by: -1 | 1) => {
    const step = steps[index];
    const target = index + by;
    if (!step || target < 0 || target >= steps.length) return;
    const without = steps.filter((s) => s.id !== step.id);
    actions.moveStep(step.id, {
      prevId: without[target - 1]?.id ?? null,
      nextId: without[target]?.id ?? null,
    });
  };

  return (
    <div className={styles.steps}>
      {steps.length > 0 && (
        <ul className={styles.list} aria-label="Steps">
          {steps.map((step, i) => (
            <StepRow
              key={step.id}
              step={step}
              index={i}
              onMove={(by) => move(i, by)}
            />
          ))}
        </ul>
      )}
      <AddStep
        taskId={taskId}
        placeholder={steps.length ? "Next step" : "Add step"}
      />
    </div>
  );
}

function StepRow({
  step,
  index,
  onMove,
}: {
  step: Step;
  index: number;
  onMove: (by: -1 | 1) => void;
}) {
  const { toggleStep, updateStep, deleteStep } = useActions();
  const [value, setValue] = useState(step.title);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const shown = editing ? value : step.title;

  const save = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const title = value.trim();
    // Like To Do, a step emptied out is a step gone
    if (!title) deleteStep(step.id);
    else if (title !== step.title) updateStep(step.id, { title });
  };

  return (
    <li
      className={styles.row}
      data-done={step.completedAt !== null || undefined}
    >
      <TaskCheck
        small
        done={step.completedAt !== null}
        label={step.title}
        onToggle={() => toggleStep(step.id)}
      />
      <input
        className={styles.title}
        aria-label={`Step ${index + 1}`}
        value={shown}
        maxLength={255}
        onFocus={() => {
          setValue(step.title);
          setEditing(true);
        }}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape" && editing) {
            // Throw the typing away instead of closing the whole pane
            e.stopPropagation();
            cancelled.current = true;
            e.currentTarget.blur();
          }
          if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            onMove(e.key === "ArrowUp" ? -1 : 1);
          }
        }}
      />
      <IconButton
        icon="close"
        label={`Delete step ${step.title}`}
        className={styles.delete}
        onPress={() => deleteStep(step.id)}
      />
    </li>
  );
}

function AddStep({
  taskId,
  placeholder,
}: {
  taskId: string;
  placeholder: string;
}) {
  const { addStep } = useActions();
  const [title, setTitle] = useState("");

  return (
    <form
      className={styles.add}
      onSubmit={(e) => {
        e.preventDefault();
        if (addStep(taskId, title)) setTitle("");
      }}
    >
      <Icon name="add" size={16} className={styles.addIcon} />
      <input
        className={styles.addInput}
        aria-label="Add step"
        placeholder={placeholder}
        value={title}
        maxLength={255}
        onChange={(e) => setTitle(e.target.value)}
      />
    </form>
  );
}
