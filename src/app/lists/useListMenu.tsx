import { useState } from "react";
import { useLocation } from "wouter";
import { INBOX_ID, type List } from "../../data/model.ts";
import { useActions } from "../../state/AppContext.tsx";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { ContextMenu, type MenuEntry } from "../../ui/ContextMenu.tsx";
import { paths } from "../routes.ts";
import { useUi } from "../uiStore.ts";

function entriesFor(list: List): MenuEntry[] {
  // The built-in Tasks list can't be renamed or deleted, like in To Do
  if (list.id === INBOX_ID) {
    return [{ id: "duplicate", label: "Duplicate list", icon: "duplicate" }];
  }
  return [
    { id: "rename", label: "Rename list", icon: "rename" },
    { id: "duplicate", label: "Duplicate list", icon: "duplicate" },
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
  const actions = useActions();
  const [, navigate] = useLocation();
  const setRenaming = useUi((s) => s.setRenaming);

  const run = (id: string, list: List) => {
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
    if (id === "delete") setToDelete(list);
  };

  const element = (
    <>
      <ContextMenu
        at={menu}
        label={`Options for ${menu?.list.title ?? "list"}`}
        items={menu ? entriesFor(menu.list) : []}
        onClose={() => setMenu(null)}
        onAction={(id) => menu && run(id, menu.list)}
      />
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
