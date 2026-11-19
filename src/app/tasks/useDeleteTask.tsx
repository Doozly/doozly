import { useState } from "react";
import type { Task } from "../../data/model.ts";
import { useActions, useAppState } from "../../state/AppContext.tsx";
import { setting } from "../../state/actions.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";

/** Deleting a task, asking first when "Confirm before deleting" is on. Render `element` once. */
export function useDeleteTask() {
  const { deleteTask } = useActions();
  const confirm = useAppState((s) => setting(s, "confirmBeforeDelete"));
  const [asking, setAsking] = useState<Task | null>(null);

  const element = (
    <ConfirmDialog
      isOpen={asking !== null}
      title={`Delete "${asking?.title ?? ""}"?`}
      message="It will be gone for good."
      confirmLabel="Delete task"
      onConfirm={() => {
        if (asking) deleteTask(asking.id);
        setAsking(null);
      }}
      onCancel={() => setAsking(null)}
    />
  );

  return {
    request(task: Task) {
      if (confirm) setAsking(task);
      else deleteTask(task.id);
    },
    element,
  };
}
