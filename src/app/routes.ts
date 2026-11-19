import { useRoute } from "wouter";

export const paths = {
  list: (listId: string) => `/lists/${encodeURIComponent(listId)}`,
  task: (listId: string, taskId: string) =>
    `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
};

export interface Selection {
  listId: string | null;
  taskId: string | null;
}

export function useSelection(): Selection {
  const [isTask, task] = useRoute("/lists/:listId/tasks/:taskId");
  const [isList, list] = useRoute("/lists/:listId");
  if (isTask) return { listId: task.listId, taskId: task.taskId };
  if (isList) return { listId: list.listId, taskId: null };
  return { listId: null, taskId: null };
}
