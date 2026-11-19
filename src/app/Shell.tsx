import { lazy, Suspense, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { Redirect, useLocation } from "wouter";
import { INBOX_ID } from "../data/model.ts";
import { useAppState } from "../state/AppContext.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Logo } from "../ui/Logo.tsx";
import { NARROW, useMediaQuery } from "../ui/useMediaQuery.ts";
import { DetailPane } from "./DetailPane.tsx";
import { ListPane } from "./ListPane.tsx";
import { paths, useSelection } from "./routes.ts";
import styles from "./Shell.module.css";
import { Sidebar } from "./Sidebar.tsx";
import { useUi } from "./uiStore.ts";

// Only needed once someone opens Settings, also it loads then
const SettingsPanel = lazy(() =>
  import("./SettingsPanel.tsx").then((m) => ({ default: m.SettingsPanel })),
);

export function Shell() {
  const { listId, taskId } = useSelection();
  const [, navigate] = useLocation();
  const narrow = useMediaQuery(NARROW);
  const { sidebarCollapsed, toggleSidebar, drawerOpen, setDrawerOpen } =
    useUi();
  const list = useAppState((s) => (listId ? s.lists[listId] : undefined));
  const task = useAppState((s) => (taskId ? s.tasks[taskId] : undefined));
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Stays mounted after the first open, so closing still animates
  const [settingsUsed, setSettingsUsed] = useState(false);

  // Unknown or deleted list, like an old link: go home
  if (!list || list.deletedAt !== null) {
    return <Redirect to={paths.list(INBOX_ID)} replace />;
  }
  if (taskId && (!task || task.deletedAt !== null || task.listId !== list.id)) {
    return <Redirect to={paths.list(list.id)} replace />;
  }

  const sidebarHidden = narrow || sidebarCollapsed;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Logo height={20} />
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
            key={list.id}
            list={list}
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
            onClose={() => navigate(paths.list(list.id))}
          />
        )}
      </div>
    </div>
  );
}
