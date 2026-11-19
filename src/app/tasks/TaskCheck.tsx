import { Checkbox } from "react-aria-components";
import { Icon } from "../../ui/Icon.tsx";
import styles from "./TaskCheck.module.css";

interface TaskCheckProps {
  done: boolean;
  /** The task title, screen readers announce it with the checked state */
  label: string;
  onToggle: () => void;
  /** Plays the little pop, for the one just ticked off */
  pop?: boolean;
  /** Steps use a smaller circle */
  small?: boolean;
}

/** The round To Do style checkbox */
export function TaskCheck({
  done,
  label,
  onToggle,
  pop,
  small,
}: TaskCheckProps) {
  return (
    <Checkbox
      className={styles.check}
      isSelected={done}
      onChange={onToggle}
      aria-label={label}
      data-pop={pop || undefined}
      data-small={small || undefined}
    >
      <span className={styles.circle} aria-hidden>
        <Icon name="check" size={12} className={styles.tick} />
      </span>
    </Checkbox>
  );
}
