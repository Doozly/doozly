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
import { Icon } from "./Icon.tsx";
import styles from "./MenuButton.module.css";
import type { MenuButtonProps } from "./MenuButton.tsx";

export function MenuButtonMenu({
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
