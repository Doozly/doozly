import { useEffect, useState } from "react";
import { INBOX_ID } from "../data/model.ts";
import { useActions } from "../state/AppContext.tsx";
import { menuPointFor } from "../ui/ContextMenu.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { InlineRename } from "../ui/InlineRename.tsx";
import styles from "./ListPane.module.css";
import {
  SortAndGroupButtons,
  SortAndGroupChips,
} from "./lists/SortAndGroup.tsx";
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
  const { updateList } = useActions();
  const canRename = list !== null && list.id !== INBOX_ID;
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    document.title = `${view.title} - Doozly`;
  }, [view.title]);

  return (
    <div
      className={styles.pane}
      data-accent={view.accent}
      // Lists saved before themes came along have no field for it
      data-background={list?.background ?? undefined}
    >
      <div className={styles.toolbar}>
        {onShowSidebar && (
          <IconButton icon="menu" label="Show lists" onPress={onShowSidebar} />
        )}
        {renaming && list ? (
          <InlineRename
            value={list.title}
            label="List name"
            className={styles.titleInput}
            onSave={(title) => updateList(list.id, { title })}
            onDone={() => setRenaming(null)}
          />
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
        {list && (
          <div className={styles.end}>
            <SortAndGroupButtons list={list} />
          </div>
        )}
        {view.id === "my-day" && (
          <div className={styles.end}>
            <IconButton
              icon="suggestions"
              label="Suggestions"
              onPress={() => setSuggesting(true)}
            />
          </div>
        )}
      </div>
      {view.subtitle && <p className={styles.subtitle}>{view.subtitle}</p>}
      {list && <SortAndGroupChips list={list} />}
      <TaskList view={view} />
      {listMenu.element}
      {view.id === "my-day" && (
        <SuggestionsPanel isOpen={suggesting} onOpenChange={setSuggesting} />
      )}
    </div>
  );
}
