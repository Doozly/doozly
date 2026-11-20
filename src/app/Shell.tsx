import {
  lazy,
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { Redirect, useLocation } from "wouter";
import { INBOX_ID } from "../data/model.ts";
import { useAppState } from "../state/AppContext.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Logo } from "../ui/Logo.tsx";
import { animateRows } from "../ui/motion.ts";
import { preloadable } from "../ui/preloadable.tsx";
import { NARROW, useMediaQuery } from "../ui/useMediaQuery.ts";
import { useToday } from "../ui/useToday.ts";
import { AccountButton } from "./account/AccountButton.tsx";
import { DragAndDrop } from "./dnd/DragAndDrop.tsx";
import { ListPane } from "./ListPane.tsx";
import { paths, useSelection } from "./routes.ts";
import styles from "./Shell.module.css";
import { Sidebar } from "./Sidebar.tsx";
import { SearchBox } from "./search/SearchBox.tsx";
import { searchTasks } from "./search/search.ts";
import { focusTaskSoon } from "./shortcuts/arrows.ts";
import { useShortcuts } from "./shortcuts/useShortcuts.tsx";
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

// Not needed for the first paint. Fetched once the page is idle, so opening a task stays instant.
export const DetailPane = preloadable(() =>
  import("./DetailPane.tsx").then((m) => m.DetailPane),
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
  // Results can lag a key behind, typing must not wait for thousands of rows
  const query = useDeferredValue(useUi((s) => s.search));
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
  const shortcuts = useShortcuts();
  useEffect(() => {
    const idle = window.requestIdleCallback ?? setTimeout;
    idle(() => void DetailPane.preload());
  }, []);

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
        <div className={styles.headerEnd}>
          <IconButton
            icon="settings"
            label="Settings"
            tone="onHeader"
            onPress={() => {
              setSettingsUsed(true);
              setSettingsOpen(true);
            }}
          />
          <AccountButton />
        </div>
      </header>
      {shortcuts.element}
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
          <main className={styles.main} data-nav-root>
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
            <Suspense fallback={null}>
              <DetailPane
                task={task}
                onClose={() => {
                  // The pane slides away
                  animateRows(() => navigate(paths.list(view.id)));
                  // Back to its row, else the focus would fall to the page with the pane
                  focusTaskSoon(task.id);
                }}
              />
            </Suspense>
          )}
        </div>
      </DragAndDrop>
    </div>
  );
}
