import { Fragment, useRef } from "react";
import { Menu, MenuItem, Popover, Separator } from "react-aria-components";
import styles from "./ContextMenu.module.css";
import { Icon, type IconName } from "./Icon.tsx";

export interface MenuEntry {
  id: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  /** Draw a line above this one */
  separated?: boolean;
}

interface ContextMenuProps {
  /** Where to open, in viewport pixels. null means closed. */
  at: { x: number; y: number } | null;
  label: string;
  items: MenuEntry[];
  onAction: (id: string) => void;
  onClose: () => void;
}

/** A menu that opens at a point, for right-click and Shift+F10 */
export function ContextMenu({
  at,
  label,
  items,
  onAction,
  onClose,
}: ContextMenuProps) {
  const anchor = useRef<HTMLDivElement>(null);

  return (
    <>
      <div
        ref={anchor}
        className={styles.anchor}
        style={{ left: at?.x ?? 0, top: at?.y ?? 0 }}
      />
      <Popover
        triggerRef={anchor}
        isOpen={at !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
        placement="bottom start"
        className={styles.popover}
      >
        <Menu
          aria-label={label}
          className={styles.menu}
          onAction={(key) => {
            // Without a MenuTrigger nobody closes the menu for us. It has to go
            // in the same render a follow-up dialog opens, or it stays behind it.
            onClose();
            onAction(String(key));
          }}
        >
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.separated && <Separator className={styles.separator} />}
              <MenuItem
                id={item.id}
                textValue={item.label}
                className={`${styles.item} ${item.danger ? styles.danger : ""}`}
              >
                <Icon name={item.icon} />
                {item.label}
              </MenuItem>
            </Fragment>
          ))}
        </Menu>
      </Popover>
    </>
  );
}

/** Where to open the menu when it comes from the keyboard */
export function menuPointFor(el: Element) {
  const box = el.getBoundingClientRect();
  return { x: box.left + 16, y: box.bottom };
}

/** The keys that ask for a context menu: the menu key, or Shift+F10 */
export function isMenuKey(e: { key: string; shiftKey: boolean }) {
  return e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
}
