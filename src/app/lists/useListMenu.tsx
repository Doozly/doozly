import { Suspense, useState } from "react";
import { useLocation } from "wouter";
import { useShallow } from "zustand/react/shallow";
import { INBOX_ID, type List, type ListGroup } from "../../data/model.ts";
import { useActions, useApp, useAppState } from "../../state/AppContext.tsx";
import { setting } from "../../state/actions.ts";
import { byPosition } from "../../state/position.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { ContextMenu, type MenuEntry } from "../../ui/ContextMenu.tsx";
import { preloadable } from "../../ui/preloadable.tsx";
import { paths } from "../routes.ts";
import { useUi } from "../uiStore.ts";
import { emailLink, listContent } from "./listText.ts";

// Only there once someone picks "Change theme"
export const ThemePicker = preloadable(() =>
  import("./ThemePicker.tsx").then((m) => m.ThemePicker),
);

function entriesFor(list: List, groups: ListGroup[]): MenuEntry[] {
  const theme: MenuEntry = {
    id: "theme",
    label: "Change theme",
    icon: "theme",
  };
  const out: MenuEntry[] = [
    { id: "print", label: "Print list", icon: "print", separated: true },
    { id: "email", label: "Email list", icon: "email" },
  ];
  // The built-in Tasks list can't be renamed, moved or deleted, like in To Do
  if (list.id === INBOX_ID) {
    return [
      theme,
      { id: "duplicate", label: "Duplicate list", icon: "duplicate" },
      ...out,
    ];
  }
  const moves: MenuEntry[] = groups
    .filter((g) => g.id !== list.groupId)
    .map((g) => ({
      id: `group:${g.id}`,
      label: `Move to ${g.title}`,
      icon: "group",
    }));
  if (list.groupId) {
    moves.push({ id: "ungroup", label: "Remove from group", icon: "group" });
  }
  if (moves[0]) moves[0] = { ...moves[0], separated: true };
  return [
    { id: "rename", label: "Rename list", icon: "rename" },
    theme,
    { id: "duplicate", label: "Duplicate list", icon: "duplicate" },
    ...out,
    ...moves,
    {
      id: "delete",
      label: "Delete list",
      icon: "delete",
      danger: true,
      separated: true,
    },
  ];
}

/**
 * The list menu, for the sidebar and the list header. Render `element` once,
 * call `open` from a right-click, Shift+F10 or the "More options" button.
 */
export function useListMenu({ onDone }: { onDone?: () => void } = {}) {
  const [menu, setMenu] = useState<{ list: List; x: number; y: number } | null>(
    null,
  );
  const [toDelete, setToDelete] = useState<List | null>(null);
  const [theming, setTheming] = useState<{
    listId: string;
    x: number;
    y: number;
  } | null>(null);
  const actions = useActions();
  const app = useApp();
  const [, navigate] = useLocation();
  const setRenaming = useUi((s) => s.setRenaming);
  const groups = useAppState(
    useShallow((s) =>
      Object.values(s.groups)
        .filter((g) => g.deletedAt === null)
        .sort(byPosition),
    ),
  );

  const run = (id: string, list: List, at: { x: number; y: number }) => {
    if (id === "rename") {
      navigate(paths.list(list.id));
      setRenaming(list.id);
      onDone?.();
    }
    if (id === "duplicate") {
      const copy = actions.duplicateList(list.id);
      if (copy) navigate(paths.list(copy.id));
      onDone?.();
    }
    if (id === "print" || id === "email") {
      const s = app.store.getState();
      const content = listContent(list, {
        tasks: s.tasks,
        steps: s.steps,
        starredFirst: setting(s, "moveStarredToTop"),
      });
      // On desktop the window keeps to the app, Rust hands mailto: to the mail app
      if (id === "email") location.href = emailLink(content);
      else void import("./printList.ts").then((m) => m.printList(content));
    }
    if (id === "delete") setToDelete(list);
    if (id === "theme") setTheming({ listId: list.id, ...at });
    if (id === "ungroup") actions.moveListToGroup(list.id, null);
    if (id.startsWith("group:")) {
      actions.moveListToGroup(list.id, id.slice("group:".length));
    }
  };

  const element = (
    <>
      <ContextMenu
        at={menu}
        label={`Options for ${menu?.list.title ?? "list"}`}
        items={menu ? entriesFor(menu.list, groups) : []}
        onClose={() => setMenu(null)}
        onAction={(id) => menu && run(id, menu.list, menu)}
      />
      {theming && (
        <Suspense fallback={null}>
          <ThemePicker
            listId={theming.listId}
            at={theming}
            onClose={() => setTheming(null)}
          />
        </Suspense>
      )}
      <ConfirmDialog
        isOpen={toDelete !== null}
        title={`Delete "${toDelete?.title ?? ""}"?`}
        message="The list and all of its tasks will be gone for good."
        confirmLabel="Delete list"
        onConfirm={() => {
          if (toDelete) actions.deleteList(toDelete.id);
          setToDelete(null);
        }}
        onCancel={() => setToDelete(null)}
      />
    </>
  );

  return {
    open: (list: List, at: { x: number; y: number }) =>
      setMenu({ list, ...at }),
    element,
  };
}
