import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Confirmation dialog for clearing all locally-stored "seen" films from the
 * list page's Seen section. Modelled on CinemaSheet's native <dialog> pattern. */
export default function SeenResetDialog({ open, count, onCancel, onConfirm }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="cinema-dialog"
      aria-labelledby="seen-reset-dialog-heading"
      onClose={onCancel}
      onClick={(e) => { if (e.target === dialogRef.current) onCancel(); }}
    >
      <div className="cinema-dialog__inner" onClick={(e) => e.stopPropagation()}>
        <div className="cinema-dialog__header">
          <div>
            <h2 className="sheet-cinema-name" id="seen-reset-dialog-heading">
              Clear seen films?
            </h2>
          </div>
          <button className="cinema-dialog__close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>

        <p className="seen-reset-dialog__body">
          This forgets all {count} film{count !== 1 ? "s" : ""} you've marked as seen on this
          device.
        </p>

        <div className="sheet-ctas">
          <button className="sheet-cta-primary sheet-cta-primary--danger" onClick={onConfirm}>
            Clear
          </button>
          <button className="sheet-cta-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
