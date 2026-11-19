import { useRef } from "react";
import {
  Dialog,
  Heading,
  Popover,
  Radio,
  RadioGroup,
} from "react-aria-components";
import { useActions, useAppState } from "../../state/AppContext.tsx";
import { type Accent, accents } from "../../styles/accents.ts";
import {
  type Background,
  backgroundLabels,
  backgrounds,
} from "../../styles/backgrounds.ts";
import { Icon } from "../../ui/Icon.tsx";
import styles from "./ThemePicker.module.css";

const NONE = "none";

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface ThemePickerProps {
  listId: string | null;
  /** Where to open, in viewport pixels, like the menu it came from */
  at: { x: number; y: number } | null;
  onClose: () => void;
}

/** Colour and background for one list. Every pick shows right away, like in To Do. */
export function ThemePicker({ listId, at, onClose }: ThemePickerProps) {
  const anchor = useRef<HTMLDivElement>(null);
  // Read live, so the ticks follow each pick
  const list = useAppState((s) => (listId ? s.lists[listId] : undefined));
  const { updateList } = useActions();
  const open = list !== undefined && at !== null;

  return (
    <>
      <div
        ref={anchor}
        className={styles.anchor}
        style={{ left: at?.x ?? 0, top: at?.y ?? 0 }}
      />
      <Popover
        triggerRef={anchor}
        isOpen={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
        placement="bottom start"
        className={styles.popover}
      >
        <Dialog
          aria-label={`Theme for ${list?.title ?? "list"}`}
          className={styles.dialog}
        >
          {list && (
            <>
              <Heading slot="title" className={styles.heading}>
                Theme
              </Heading>
              <RadioGroup
                aria-label="Colour"
                orientation="horizontal"
                className={styles.swatches}
                value={list.accent}
                onChange={(accent) =>
                  updateList(list.id, { accent: accent as Accent })
                }
              >
                {accents.map((accent) => (
                  <Radio
                    key={accent}
                    value={accent}
                    aria-label={capitalised(accent)}
                    className={styles.swatch}
                    data-accent={accent}
                  >
                    <Icon name="check" size={16} />
                  </Radio>
                ))}
              </RadioGroup>
              <RadioGroup
                aria-label="Background"
                orientation="horizontal"
                className={styles.backgrounds}
                value={list.background ?? NONE}
                onChange={(value) =>
                  updateList(list.id, {
                    background: value === NONE ? null : (value as Background),
                  })
                }
              >
                <Radio
                  value={NONE}
                  aria-label="No background"
                  className={`${styles.background} ${styles.none}`}
                >
                  <Icon name="check" size={16} />
                </Radio>
                {backgrounds.map((b) => (
                  <Radio
                    key={b}
                    value={b}
                    aria-label={backgroundLabels[b]}
                    className={styles.background}
                    data-background={b}
                  >
                    <Icon name="check" size={16} />
                  </Radio>
                ))}
              </RadioGroup>
            </>
          )}
        </Dialog>
      </Popover>
    </>
  );
}
