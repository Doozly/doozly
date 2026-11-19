import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useShallow } from "zustand/react/shallow";
import { INBOX_ID, type List } from "../data/model.ts";
import { useActions, useAppState } from "../state/AppContext.tsx";
import { uniqueTitle } from "../state/naming.ts";
import { byPosition } from "../state/position.ts";
import { isMenuKey, menuPointFor } from "../ui/ContextMenu.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { useListMenu } from "./lists/useListMenu.tsx";
import { paths, useSelection } from "./routes.ts";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  /** Wide screens get a button to hide the sidebar */
  onCollapse?: () => void;
  /** Called after picking or making a list, so the drawer can close */
  onNavigate?: () => void;
}

export function Sidebar({ onCollapse, onNavigate }: SidebarProps) {
  const lists = useAppState(
    useShallow((s) =>
      Object.values(s.lists)
        .filter((l) => l.deletedAt === null)
        .sort(byPosition),
    ),
  );
  const counts = useAppState(useShallow(openTaskCounts));
  const listMenu = useListMenu({ onDone: onNavigate });
  const inbox = lists.find((l) => l.id === INBOX_ID);
  const own = lists.filter((l) => l.id !== INBOX_ID);

  return (
    <nav aria-label="Lists" className={styles.sidebar}>
      {onCollapse && (
        <div className={styles.top}>
          <IconButton icon="menu" label="Hide sidebar" onPress={onCollapse} />
        </div>
      )}
      <div className={styles.scroll}>
        {/* Smart lists (My Day, Important, Planned, All) join Tasks up here in phase 3 */}
        <ul className={styles.section}>
          {inbox && (
            <ListItem
              list={inbox}
              icon="tasks"
              count={counts[inbox.id]}
              onNavigate={onNavigate}
              onMenu={listMenu.open}
            />
          )}
        </ul>
        {own.length > 0 && (
          <ul className={`${styles.section} ${styles.own}`}>
            {own.map((list) => (
              <ListItem
                key={list.id}
                list={list}
                icon="list"
                count={counts[list.id]}
                onNavigate={onNavigate}
                onMenu={listMenu.open}
              />
            ))}
          </ul>
        )}
      </div>
      <NewList
        taken={lists.map((l) => l.title)}
        onCreated={() => onNavigate?.()}
      />
      {listMenu.element}
    </nav>
  );
}

function openTaskCounts(s: {
  tasks: Record<
    string,
    { listId: string; deletedAt: number | null; completedAt: number | null }
  >;
}): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of Object.values(s.tasks)) {
    if (t.deletedAt === null && t.completedAt === null) {
      counts[t.listId] = (counts[t.listId] ?? 0) + 1;
    }
  }
  return counts;
}

interface ListItemProps {
  list: List;
  icon: IconName;
  count: number | undefined;
  onNavigate?: () => void;
  onMenu: (list: List, at: { x: number; y: number }) => void;
}

function ListItem({ list, icon, count, onNavigate, onMenu }: ListItemProps) {
  const { listId } = useSelection();
  return (
    <li>
      <Link
        href={paths.list(list.id)}
        className={styles.item}
        aria-current={list.id === listId ? "page" : undefined}
        data-accent={list.accent}
        onClick={onNavigate}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(list, { x: e.clientX, y: e.clientY });
        }}
        onKeyDown={(e) => {
          if (isMenuKey(e)) {
            e.preventDefault();
            onMenu(list, menuPointFor(e.currentTarget));
          }
        }}
      >
        <Icon name={icon} />
        <span className={styles.title}>{list.title}</span>
        {/* The space keeps title and count apart for screen readers, flex hides it */}{" "}
        {count ? (
          <span className={styles.count}>
            {count}{" "}
            <span className="visually-hidden">
              {count === 1 ? "open task" : "open tasks"}
            </span>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function NewList({
  taken,
  onCreated,
}: {
  taken: string[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [, navigate] = useLocation();
  const { addList } = useActions();

  return (
    <form
      className={styles.newList}
      onSubmit={(e) => {
        e.preventDefault();
        const list = addList(
          title.trim() || uniqueTitle("Untitled list", taken),
        );
        setTitle("");
        navigate(paths.list(list.id));
        onCreated();
      }}
    >
      <Icon name="add" />
      <input
        className={styles.newListInput}
        aria-label="New list"
        placeholder="New list"
        value={title}
        maxLength={255}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setTitle("");
            e.currentTarget.blur();
          }
        }}
      />
    </form>
  );
}
