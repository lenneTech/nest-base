/**
 * Dev-Portal DialogModal — react-aria-components `DialogTrigger` +
 * `Modal` + `Dialog`.
 *
 * Wraps the trigger element + content together so callers don't need to
 * repeat the boilerplate. Backdrop closes on click; focus is trapped
 * inside the modal automatically.
 */
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from "react-aria-components";

export interface DialogModalProps {
  trigger: React.ReactNode;
  title: string;
  children: (state: { close: () => void }) => React.ReactNode;
  triggerVariant?: "default" | "accent";
}

export function DialogModal({
  trigger,
  title,
  children,
  triggerVariant = "default",
}: DialogModalProps) {
  const triggerClass = triggerVariant === "accent" ? "dp-button dp-button--accent" : "dp-button";
  return (
    <DialogTrigger>
      <Button className={triggerClass}>{trigger}</Button>
      <ModalOverlay className="dp-modal-overlay">
        <Modal className="dp-modal">
          <Dialog>
            {({ close }) => (
              <>
                <Heading slot="title" className="dp-modal__title">
                  {title}
                </Heading>
                {children({ close })}
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
