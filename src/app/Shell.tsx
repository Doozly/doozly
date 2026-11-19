import { lazy, Suspense, useMemo, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { Redirect, useLocation } from "wouter";
import { INBOX_ID } from "../data/model.ts";
import { useAppState } from "../state/AppContext.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Logo } from "../ui/Logo.tsx";
import { NARROW, useMediaQuery } from "../ui/useMediaQuery.ts";
import { useToday } from "../ui/useToday.ts";
import { DetailPane } from "./DetailPane.tsx";
import { DragAndDrop } from "./dnd/DragAndDrop.tsx";
import { ListPane } from "./ListPane.tsx";
import { paths, useSelection } from "./routes.ts";
import styles from "./Shell.module.css";
import { Sidebar } from "./Sidebar.tsx";
import { SearchBox } from "./search/SearchBox.tsx";
import { searchTasks } from "./search/search.ts";
import { useUi } from "./uiStore.ts";
import {
  isSmartId,
  listView,
  SEARCH_ID,
  searchView,
  smartView,
} from "./views.ts";

// Only needed once someone opens Settings, also it loads then
const SettingsPanel = lazy(() =>
  import("./SettingsPanel.tsx").then((m) => ({ default: m.SettingsPanel })),
);

export function Shell() {
  const { listId, taskId } = useSelection();
  const [, navigate] = useLocation();
  const narrow = useMediaQuery(NARROW);
  const now = useToday();
  const { sidebarCollapsed, toggleSidebar, drawerOpen, setDrawerOpen } =
    useUi();
  const list = useAppState((s) => (listId ? s.lists[listId] : undefined));
  const task = useAppState((s) => (taskId ? s.tasks[taskId] : undefined));
  const searching = listId === SEARCH_ID;
  const query = useUi((s) => s.search);
  // Only watched while searching, so a normal list doesn't re-render on every step change
  const tasks = useAppState((s) => (searching ? s.tasks : null));
  const steps = useAppState((s) => (searching ? s.steps : null));
  const matches = useMemo(
    () => searchTasks(query, tasks ?? {}, steps ?? {}),
    [query, tasks, steps],
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Stays mounted after the first open, so closing still animates
  const [settingsUsed, setSettingsUsed] = useState(false);

  const view = searching
    ? searchView(query, matches)
    : listId && isSmartId(listId)
      ? smartView(listId, now)
      : list && list.deletedAt === null
        ? listView(list)
        : null;

  // Unknown or deleted list, like an old link: go home
  if (!view) {
    return <Redirect to={paths.list(INBOX_ID)} replace />;
  }
  // A smart list can open any task; a normal list only its own
  const taskFits = task && (view.list === null || task.listId === view.id);
  if (taskId && (!task || task.deletedAt !== null || !taskFits)) {
    return <Redirect to={paths.list(view.id)} replace />;
  }

  const sidebarHidden = narrow || sidebarCollapsed;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Logo height={20} />
        <div className={styles.headerSearch}>
          <SearchBox />
        </div>
        <IconButton
          icon="settings"
          label="Settings"
          tone="onHeader"
          className={styles.headerEnd}
          onPress={() => {
            setSettingsUsed(true);
            setSettingsOpen(true);
          }}
        />
      </header>
      {settingsUsed && (
        <Suspense fallback={null}>
          <SettingsPanel isOpen={settingsOpen} onOpenChange={setSettingsOpen} />
        </Suspense>
      )}
      <DragAndDrop>
        <div className={styles.body}>
          {!sidebarHidden && (
            <div className={styles.sidebar}>
              <Sidebar onCollapse={toggleSidebar} />
            </div>
          )}
          {narrow && (
            <ModalOverlay
              isOpen={drawerOpen}
              onOpenChange={setDrawerOpen}
              isDismissable
              className={styles.scrim}
            >
              <Modal className={styles.drawer}>
                <Dialog aria-label="Lists" className={styles.drawerDialog}>
                  <Sidebar onNavigate={() => setDrawerOpen(false)} />
                </Dialog>
              </Modal>
            </ModalOverlay>
          )}
          <main className={styles.main}>
            <ListPane
              key={view.id}
              view={view}
              onShowSidebar={
                sidebarHidden
                  ? () => (narrow ? setDrawerOpen(true) : toggleSidebar())
                  : undefined
              }
            />
          </main>
          {task && (
            <DetailPane
              key={task.id}
              task={task}
              onClose={() => navigate(paths.list(view.id))}
            />
          )}
        </div>
      </DragAndDrop>
    </div>
  );
}
