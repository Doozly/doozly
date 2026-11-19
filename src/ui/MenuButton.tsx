import { Fragment } from "react";
import {
  Button,
  Header,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Separator,
} from "react-aria-components";
import menuStyles from "./ContextMenu.module.css";
import type { MenuEntry } from "./ContextMenu.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import styles from "./MenuButton.module.css";

interface MenuButtonProps {
  icon: IconName;
  /** Next to the icon, hidden on narrow screens but still read out */
  label: string;
  /** A small heading on top of the menu, like "Sort by" */
  title: string;
  items: MenuEntry[];
  onAction: (id: string) => void;
}

/** A toolbar button with a text label that drops down a menu */
export function MenuButton({
  icon,
  label,
  title,
  items,
  onAction,
}: MenuButtonProps) {
  return (
    <MenuTrigger>
      <Button className={styles.button} aria-label={label}>
        <Icon name={icon} />
        <span className={styles.label}>{label}</span>
      </Button>
      <Popover placement="bottom end" className={menuStyles.popover}>
        <Menu
          aria-label={title}
          className={menuStyles.menu}
          onAction={(key) => onAction(String(key))}
        >
          <MenuSection>
            <Header className={styles.title}>{title}</Header>
            {items.map((item) => (
              <Fragment key={item.id}>
                {item.separated && (
                  <Separator className={menuStyles.separator} />
                )}
                <MenuItem
                  id={item.id}
                  textValue={item.label}
                  className={menuStyles.item}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </MenuItem>
              </Fragment>
            ))}
          </MenuSection>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
