import { Suspense } from "react";
import { Button } from "react-aria-components";
import type { MenuEntry } from "./ContextMenu.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import styles from "./MenuButton.module.css";
import { preloadable } from "./preloadable.tsx";

export interface MenuButtonProps {
  icon: IconName;
  /** Next to the icon, hidden on narrow screens but still read out */
  label: string;
  /** A small heading on top of the menu, like "Sort by" */
  title: string;
  items: MenuEntry[];
  onAction: (id: string) => void;
}

// React Aria's menu code isn't needed for the first paint, also it follows right after
const WithMenu = preloadable(() =>
  import("./MenuButtonMenu.tsx").then((m) => m.MenuButtonMenu),
);

export const preloadMenuButton = WithMenu.preload;

/** A toolbar button with a text label that drops down a menu */
export function MenuButton(props: MenuButtonProps) {
  // The same button meanwhile. Disabled, so an early click waits instead of getting lost.
  const placeholder = (
    <Button className={styles.button} aria-label={props.label} isDisabled>
      <Icon name={props.icon} />
      <span className={styles.label}>{props.label}</span>
    </Button>
  );
  return (
    <Suspense fallback={placeholder}>
      <WithMenu {...props} />
    </Suspense>
  );
}
