import { closestCenter, DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Step } from "../../data/model.ts";
import { useActions, useAppState } from "../../state/AppContext.tsx";
import { byPosition } from "../../state/position.ts";
import { Icon } from "../../ui/Icon.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { swallowNextClick, useDragSensors } from "../dnd/DragAndDrop.tsx";
import { MOVE_KEYS, moveKey, nudge, placementAt } from "../dnd/reorder.ts";
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
  const ids = steps.map((s) => s.id);
  // The row is mostly a text field, a short hold tells dragging apart from selecting text
  const sensors = useDragSensors({ delay: 250, tolerance: 5 });

  const move = (id: string, by: -1 | 1) => {
    const at = nudge(ids, id, by);
    if (at) actions.moveStep(id, at);
  };

  return (
    <div className={styles.steps}>
      {steps.length > 0 && (
        // Its own context, steps only ever move among each other
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            swallowNextClick();
            const from = ids.indexOf(String(active.id));
            const to = over ? ids.indexOf(String(over.id)) : -1;
            if (from < 0 || to < 0 || from === to) return;
            actions.moveStep(String(active.id), placementAt(ids, from, to));
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className={styles.list} aria-label="Steps">
              {steps.map((step, i) => (
                <StepRow
                  key={step.id}
                  step={step}
                  index={i}
                  onMove={(by) => move(step.id, by)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
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
  const { setNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id: step.id });

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
      ref={setNodeRef}
      className={styles.row}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-done={step.completedAt !== null || undefined}
      data-dragging={isDragging || undefined}
      {...listeners}
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
        aria-keyshortcuts={MOVE_KEYS}
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
          const by = moveKey(e);
          if (by) {
            e.preventDefault();
            onMove(by);
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
