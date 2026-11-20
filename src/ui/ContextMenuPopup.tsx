import { Fragment, type Key, type RefObject } from "react";
import {
  Menu,
  MenuItem,
  Popover,
  Separator,
  SubmenuTrigger,
} from "react-aria-components";
import styles from "./ContextMenu.module.css";
import type { ContextMenuProps, MenuEntry } from "./ContextMenu.tsx";
import { Icon } from "./Icon.tsx";

export function ContextMenuPopup({
  anchor,
  at,
  label,
  items,
  onAction,
  onClose,
}: ContextMenuProps & { anchor: RefObject<HTMLDivElement | null> }) {
  // Without a MenuTrigger nobody closes the menu for us. It has to go
  // in the same render a follow-up dialog opens, or it stays behind it.
  const act = (key: Key) => {
    onClose();
    onAction(String(key));
  };

  return (
    <Popover
      triggerRef={anchor}
      isOpen={at !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      placement="bottom start"
      className={styles.popover}
    >
      <Menu aria-label={label} className={styles.menu} onAction={act}>
        {items.map((item) => (
          <Fragment key={item.id}>
            {item.separated && <Separator className={styles.separator} />}
            {item.children ? (
              <SubmenuTrigger>
                <Item item={item} />
                <Popover className={styles.popover} offset={-4}>
                  <Menu
                    aria-label={item.label}
                    className={styles.menu}
                    onAction={act}
                  >
                    {item.children.map((child) => (
                      <Item key={child.id} item={child} />
                    ))}
                  </Menu>
                </Popover>
              </SubmenuTrigger>
            ) : (
              <Item item={item} />
            )}
          </Fragment>
        ))}
      </Menu>
    </Popover>
  );
}

function Item({ item }: { item: MenuEntry }) {
  return (
    <MenuItem
      id={item.id}
      textValue={item.label}
      className={`${styles.item} ${item.danger ? styles.danger : ""}`}
    >
      <Icon name={item.icon} />
      <span className={styles.label}>{item.label}</span>
      {item.children && <Icon name="chevronRight" />}
    </MenuItem>
  );
}
