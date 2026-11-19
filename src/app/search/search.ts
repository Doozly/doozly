import type { Step, Task } from "../../data/model.ts";

/** Lower case with the accents gone, so "Café" finds "cafe" and the other way round */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/**
 * Ids of the tasks that have every word of the query somewhere in their title,
 * note or steps. Deleted ones never match. An empty query matches nothing.
 */
export function searchTasks(
  query: string,
  tasks: Record<string, Task>,
  steps: Record<string, Step>,
): Set<string> {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const found = new Set<string>();
  if (words.length === 0) return found;

  const stepText = new Map<string, string>();
  for (const s of Object.values(steps)) {
    if (s.deletedAt !== null) continue;
    stepText.set(s.taskId, `${stepText.get(s.taskId) ?? ""}\n${s.title}`);
  }
  for (const t of Object.values(tasks)) {
    if (t.deletedAt !== null) continue;
    const text = fold(`${t.title}\n${t.note}${stepText.get(t.id) ?? ""}`);
    if (words.every((w) => text.includes(w))) found.add(t.id);
  }
  return found;
}
