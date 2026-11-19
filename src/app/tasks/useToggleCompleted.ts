import type { Task } from "../../data/model.ts";
import { useActions, useAppState } from "../../state/AppContext.tsx";
import { setting } from "../../state/actions.ts";
import { playDing } from "../../ui/sound.ts";

/** Ticks a task on or off, with the chime when that's on. Says whether it got completed. */
export function useToggleCompleted() {
  const { toggleCompleted } = useActions();
  const sound = useAppState((s) => setting(s, "playCompletionSound"));
  return (task: Task): boolean => {
    const completing = task.completedAt === null;
    toggleCompleted(task.id);
    if (completing && sound) playDing();
    return completing;
  };
}
