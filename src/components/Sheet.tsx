import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

interface Props {
  /** Id of the sheet's heading, for the dialog's accessible name. */
  labelledBy: string;
  onClose: () => void;
  children: ComponentChildren;
}

// How far a downward drag has to travel before letting go closes the sheet.
const SWIPE_CLOSE_PX = 90;

/**
 * A modal sheet: bottom sheet on phones, centred card on desktop. Closes on
 * backdrop tap, Esc, swipe down and Back. Back works by pushing a same-document
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

    let drag: { startY: number; dy: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      if (dialog.scrollTop === 0) drag = { startY: e.touches[0].clientY, dy: 0 };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!drag) return;
      drag.dy = Math.max(0, e.touches[0].clientY - drag.startY);
      // CSSOM writes are allowed under the CSP; only the style attribute in markup is blocked.
      dialog.style.transform = `translateY(${drag.dy}px)`;
    };
    const onTouchEnd = () => {
      const dy = drag?.dy ?? 0;
      drag = null;
      if (dy > SWIPE_CLOSE_PX) onCloseRef.current();
      else dialog.style.transform = "";
    };

    window.addEventListener("popstate", onPop);
    dialog.addEventListener("touchstart", onTouchStart, { passive: true });
    dialog.addEventListener("touchmove", onTouchMove, { passive: true });
    dialog.addEventListener("touchend", onTouchEnd);
    dialog.addEventListener("touchcancel", onTouchEnd);
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
        <div class="grab" aria-hidden="true" />
        {children}
      </div>
    </dialog>
  );
}
