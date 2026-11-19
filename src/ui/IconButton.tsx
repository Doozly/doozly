import { Button, type ButtonProps } from "react-aria-components";
import { Icon, type IconName } from "./Icon.tsx";
import styles from "./IconButton.module.css";

type IconButtonProps = Omit<ButtonProps, "children" | "aria-label"> & {
  icon: IconName;
  /** Read out by screen readers, the button has no visible text */
  label: string;
  filled?: boolean;
  tone?: "default" | "onHeader";
};

export function IconButton({
  icon,
  label,
  filled,
  tone = "default",
  className,
  ...rest
}: IconButtonProps) {
  return (
    <Button
      {...rest}
      aria-label={label}
      className={`${styles.button} ${tone === "onHeader" ? styles.onHeader : ""} ${className ?? ""}`}
    >
      <Icon name={icon} filled={filled} />
    </Button>
  );
}
