import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Red for deleting, the accent colour for anything else */
  tone?: "danger" | "accent";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      isDismissable
      className={styles.overlay}
    >
      <Modal className={styles.modal}>
        <Dialog role="alertdialog" className={styles.dialog}>
          <Heading slot="title" className={styles.title}>
            {title}
          </Heading>
          <p className={styles.message}>{message}</p>
          <div className={styles.buttons}>
            <Button className={styles.button} onPress={onCancel}>
              Cancel
            </Button>
            <Button
              className={`${styles.button} ${styles[tone]}`}
              onPress={onConfirm}
              autoFocus
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
