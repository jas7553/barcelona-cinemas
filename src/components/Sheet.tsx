import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

interface Props {
  /** Id of the sheet's heading, for the dialog's accessible name. */
  labelledBy: string;
  onClose: () => void;
  children: ComponentChildren;
}

/**
 * A modal sheet: bottom sheet on phones, centred card on desktop. Closes on
 * backdrop tap, Esc and Back. Back works by pushing a same-document
 * history entry while open, so it closes the sheet instead of leaving the page.
 * Mount it to open, unmount to close.
 */
export function Sheet({ labelledBy, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    history.pushState({ sheet: true }, "");
    let closedByBack = false;
    const onPop = () => {
      closedByBack = true;
      onCloseRef.current();
    };

    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      dialog.close();
      if (!closedByBack) history.back();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      class="sheet"
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // The body fills the dialog box, so a click landing on the dialog itself is the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="sheet-body">
        {children}
      </div>
    </dialog>
  );
}
