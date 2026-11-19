import { useEffect, useRef, useState } from "react";
import { INBOX_ID, type List } from "../data/model.ts";
import { useActions } from "../state/AppContext.tsx";
import { menuPointFor } from "../ui/ContextMenu.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import styles from "./ListPane.module.css";
import { useListMenu } from "./lists/useListMenu.tsx";
import { SuggestionsPanel } from "./myday/SuggestionsPanel.tsx";
import { TaskList } from "./tasks/TaskList.tsx";
import { useUi } from "./uiStore.ts";
import type { View } from "./views.ts";

interface ListPaneProps {
  view: View;
  /** Shown when the sidebar is hidden or a drawer */
  onShowSidebar?: () => void;
}

export function ListPane({ view, onShowSidebar }: ListPaneProps) {
  const { list } = view;
  const renaming = useUi((s) => list !== null && s.renamingListId === list.id);
  const setRenaming = useUi((s) => s.setRenaming);
  const listMenu = useListMenu();
  const canRename = list !== null && list.id !== INBOX_ID;
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    document.title = `${view.title} - Doozly`;
  }, [view.title]);

  return (
    <div className={styles.pane} data-accent={view.accent}>
      <div className={styles.toolbar}>
        {onShowSidebar && (
          <IconButton icon="menu" label="Show lists" onPress={onShowSidebar} />
        )}
        {renaming && list ? (
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
              view.title
            )}
          </h1>
        )}
        {list && (
          <IconButton
            icon="more"
            label="List options"
            onPress={(e) => listMenu.open(list, menuPointFor(e.target))}
          />
        )}
        {view.id === "my-day" && (
          <IconButton
            icon="suggestions"
            label="Suggestions"
            className={styles.end}
            onPress={() => setSuggesting(true)}
          />
        )}
      </div>
      {view.subtitle && <p className={styles.subtitle}>{view.subtitle}</p>}
      <TaskList view={view} />
      {listMenu.element}
      {view.id === "my-day" && (
        <SuggestionsPanel isOpen={suggesting} onOpenChange={setSuggesting} />
      )}
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
