import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { IconButton } from "./IconButton.tsx";
import styles from "./SidePanel.module.css";

interface SidePanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Read out for the close button, like "Close settings" */
  closeLabel: string;
  children: ReactNode;
}

/** A modal sheet sliding in from the right, for Settings and Suggestions */
export function SidePanel({
  isOpen,
  onOpenChange,
  title,
  closeLabel,
  children,
}: SidePanelProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className={styles.overlay}
    >
      <Modal className={styles.sheet}>
        <Dialog className={styles.dialog}>
          {({ close }) => (
            <>
              <div className={styles.top}>
                <Heading slot="title" className={styles.heading}>
                  {title}
                </Heading>
                <IconButton icon="close" label={closeLabel} onPress={close} />
              </div>
              {children}
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
