import { useEffect, useRef } from "react";
import { INBOX_ID, type List } from "../data/model.ts";
import { useActions } from "../state/AppContext.tsx";
import { menuPointFor } from "../ui/ContextMenu.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import styles from "./ListPane.module.css";
import { useListMenu } from "./lists/useListMenu.tsx";
import { TaskList } from "./tasks/TaskList.tsx";
import { useUi } from "./uiStore.ts";

interface ListPaneProps {
  list: List;
  /** Shown when the sidebar is hidden or a drawer */
  onShowSidebar?: () => void;
}

export function ListPane({ list, onShowSidebar }: ListPaneProps) {
  const renaming = useUi((s) => s.renamingListId === list.id);
  const setRenaming = useUi((s) => s.setRenaming);
  const listMenu = useListMenu();
  const canRename = list.id !== INBOX_ID;

  useEffect(() => {
    document.title = `${list.title} - Doozly`;
  }, [list.title]);

  return (
    <div className={styles.pane} data-accent={list.accent}>
      <div className={styles.toolbar}>
        {onShowSidebar && (
          <IconButton icon="menu" label="Show lists" onPress={onShowSidebar} />
        )}
        {renaming ? (
          <TitleEditor list={list} onDone={() => setRenaming(null)} />
        ) : (
          <h1 className={styles.title}>
            {canRename ? (
              // Like To Do, clicking the title of your own list renames it
              <button
                type="button"
                className={styles.titleButton}
                title="Rename list"
                onClick={() => setRenaming(list.id)}
              >
                {list.title}
              </button>
            ) : (
              list.title
            )}
          </h1>
        )}
        <IconButton
          icon="more"
          label="List options"
          onPress={(e) => listMenu.open(list, menuPointFor(e.target))}
        />
      </div>
      <TaskList listId={list.id} />
      {listMenu.element}
    </div>
  );
}

function TitleEditor({ list, onDone }: { list: List; onDone: () => void }) {
  const { updateList } = useActions();
  const cancelled = useRef(false);

  const save = (value: string) => {
    const title = value.trim();
    if (!cancelled.current && title && title !== list.title) {
      updateList(list.id, { title });
    }
    onDone();
  };

  return (
    <input
      className={styles.titleInput}
      aria-label="List name"
      defaultValue={list.title}
      maxLength={255}
      // biome-ignore lint/a11y/noAutofocus: the user just asked to rename, the field is the point
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => save(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
