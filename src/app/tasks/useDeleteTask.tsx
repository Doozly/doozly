import { useState } from "react";
import type { Task } from "../../data/model.ts";
import { useActions, useAppState } from "../../state/AppContext.tsx";
import { setting } from "../../state/actions.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { animateRows } from "../../ui/motion.ts";

/** Deleting a task, asking first when "Confirm before deleting" is on. Render `element` once. */
export function useDeleteTask() {
  const { deleteTask } = useActions();
  const confirm = useAppState((s) => setting(s, "confirmBeforeDelete"));
  const remove = (task: Task, onDeleted?: () => void) => {
    animateRows(() => deleteTask(task.id));
    onDeleted?.();
  };
  const [asking, setAsking] = useState<{
    task: Task;
    onDeleted?: () => void;
  } | null>(null);

  const element = (
    <ConfirmDialog
      isOpen={asking !== null}
      title={`Delete "${asking?.task.title ?? ""}"?`}
      message="It will be gone for good."
      confirmLabel="Delete task"
      onConfirm={() => {
        if (asking) remove(asking.task, asking.onDeleted);
        setAsking(null);
      }}
      onCancel={() => setAsking(null)}
    />
  );

  return {
    /** `onDeleted` runs only if it really went, not when the user said no */
    request(task: Task, onDeleted?: () => void) {
      if (confirm) setAsking({ task, onDeleted });
      else remove(task, onDeleted);
    },
    element,
  };
}
