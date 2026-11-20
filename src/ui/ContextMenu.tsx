import { Suspense, useEffect, useRef } from "react";
import styles from "./ContextMenu.module.css";
import type { IconName } from "./Icon.tsx";
import { preloadable } from "./preloadable.tsx";

export interface MenuEntry {
  id: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  /** Draw a line above this one */
  separated?: boolean;
  /** Opens a submenu instead of being an action itself */
  children?: MenuEntry[];
}

export interface ContextMenuProps {
  /** Where to open, in viewport pixels. null means closed. */
  at: { x: number; y: number } | null;
  label: string;
  items: MenuEntry[];
  onAction: (id: string) => void;
  onClose: () => void;
}

// Not needed for the first paint, also it's fetched once the page is idle
const Popup = preloadable(() =>
  import("./ContextMenuPopup.tsx").then((m) => m.ContextMenuPopup),
);

/** A menu that opens at a point, for right-click and Shift+F10 */
export function ContextMenu(props: ContextMenuProps) {
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const idle = window.requestIdleCallback ?? setTimeout;
    idle(() => void Popup.preload());
  }, []);

  return (
    <>
      <div
        ref={anchor}
        className={styles.anchor}
        style={{ left: props.at?.x ?? 0, top: props.at?.y ?? 0 }}
      />
      {props.at && (
        <Suspense fallback={null}>
          <Popup anchor={anchor} {...props} />
        </Suspense>
      )}
    </>
  );
}

export const preloadContextMenu = Popup.preload;

/** Where to open the menu when it comes from the keyboard */
export function menuPointFor(el: Element) {
  const box = el.getBoundingClientRect();
  return { x: box.left + 16, y: box.bottom };
}

/** The keys that ask for a context menu: the menu key, or Shift+F10 */
export function isMenuKey(e: { key: string; shiftKey: boolean }) {
  return e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
}
