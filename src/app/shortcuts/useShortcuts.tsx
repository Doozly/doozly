import { lazy, Suspense, useEffect } from "react";
import { useLocation } from "wouter";
import { useActions, useApp, useAppState } from "../../state/AppContext.tsx";
import { setting } from "../../state/actions.ts";
import { uniqueTitle } from "../../state/naming.ts";
import { animateRows } from "../../ui/motion.ts";
import { NARROW, useMediaQuery } from "../../ui/useMediaQuery.ts";
import { useSession } from "../account/SessionContext.tsx";
import { paths, useSelection } from "../routes.ts";
import { useDeleteTask } from "../tasks/useDeleteTask.tsx";
import { useToggleCompleted } from "../tasks/useToggleCompleted.ts";
import { useUi } from "../uiStore.ts";
import { focusTaskSoon } from "./arrows.ts";
import {
  inOverlay,
  type ShortcutAction,
  shortcutFor,
  typingIn,
} from "./keys.ts";

const ShortcutHelp = lazy(() =>
  import("./ShortcutHelp.tsx").then((m) => ({ default: m.ShortcutHelp })),
);

/** The app-wide keys. Render `element` once, it has the help and the delete question. */
export function useShortcuts() {
  const app = useApp();
  const { addList, toggleMyDay, toggleImportant } = useActions();
  const toggleCompleted = useToggleCompleted();
  const deleting = useDeleteTask();
  const session = useSession();
  const enabled = useAppState((s) => setting(s, "keyboardShortcuts"));
  const { listId, taskId } = useSelection();
  const [, navigate] = useLocation();
  const narrow = useMediaQuery(NARROW);
  const helpOpen = useUi((s) => s.shortcutsOpen);
  const helpUsed = useUi((s) => s.shortcutsUsed);

  const run = (action: ShortcutAction) => {
    const ui = useUi.getState();
    const focused = document.activeElement;
    const row = focused?.closest<HTMLElement>("[data-task-id]");
    // The task with the focus, else the one open in the details
    const task =
      app.store.getState().tasks[row?.dataset.taskId ?? taskId ?? ""];
    const live = task && task.deletedAt === null ? task : undefined;

    switch (action) {
      case "newTask":
        return focusField("add-task");
      case "search":
        return focusField("search");
      case "newList": {
        const taken = Object.values(app.store.getState().lists)
          .filter((l) => l.deletedAt === null)
          .map((l) => l.title);
        const list = addList(uniqueTitle("Untitled list", taken));
        navigate(paths.list(list.id));
        ui.setRenaming(list.id);
        return true;
      }
      case "complete":
        if (live) toggleCompleted(live);
        return live !== undefined;
      case "myDay":
        if (live) animateRows(() => toggleMyDay(live.id));
        return live !== undefined;
      case "star":
        if (live) animateRows(() => toggleImportant(live.id));
        return live !== undefined;
      case "delete": {
        if (!live) return false;
        const next = neighbourOf(live.id);
        deleting.request(live, () => {
          if (next) focusTaskSoon(next);
          else requestAnimationFrame(() => focusField("add-task"));
        });
        return true;
      }
      case "sync":
        void session?.syncNow();
        return true;
      case "sidebar":
        if (narrow) ui.setDrawerOpen(!ui.drawerOpen);
        else ui.toggleSidebar();
        return true;
      case "help":
        ui.setShortcutsOpen(true);
        return true;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = document.activeElement;
      if (typingIn(target) || inOverlay(target)) return;
      if (e.key === "Escape" && taskId && listId) {
        const closing = taskId;
        animateRows(() => navigate(paths.list(listId)));
        focusTaskSoon(closing);
        return;
      }
      const action = shortcutFor(e);
      // Delete isn't a character key, so it stays even with the letters turned off
      if (!action || (!enabled && action !== "delete")) return;
      if (run(action)) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return {
    element: (
      <>
        {deleting.element}
        {helpUsed && (
          <Suspense fallback={null}>
            <ShortcutHelp
              isOpen={helpOpen}
              onClose={() => useUi.getState().setShortcutsOpen(false)}
            />
          </Suspense>
        )}
      </>
    ),
  };
}

function focusField(name: string): boolean {
  const field = document.querySelector<HTMLElement>(
    `[data-shortcut="${name}"]`,
  );
  field?.focus();
  return field != null;
}

/** The task below, or else above, so the focus has somewhere to go after a delete */
function neighbourOf(taskId: string): string | undefined {
  const rows = [
    ...document.querySelectorAll<HTMLElement>("main [data-task-id]"),
  ];
  const at = rows.findIndex((r) => r.dataset.taskId === taskId);
  if (at < 0) return undefined;
  return (rows[at + 1] ?? rows[at - 1])?.dataset.taskId;
}
