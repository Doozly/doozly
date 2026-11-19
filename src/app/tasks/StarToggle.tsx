import { ToggleButton } from "react-aria-components";
import { Icon } from "../../ui/Icon.tsx";
import styles from "./StarToggle.module.css";

interface StarToggleProps {
  important: boolean;
  onToggle: () => void;
  /** The task title, so "Important" says which task in a long list */
  taskTitle: string;
}

export function StarToggle({
  important,
  onToggle,
  taskTitle,
}: StarToggleProps) {
  return (
    <ToggleButton
      className={styles.star}
      isSelected={important}
      onChange={onToggle}
      aria-label={`Important: ${taskTitle}`}
    >
      <Icon name="important" filled={important} />
    </ToggleButton>
  );
}
