import { useEffect, useRef } from "react";
import type { Theater } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  theaters: Theater[];
  selectedTheater: string;
  onSelect: (id: string) => void;
}

export default function TheaterFilterSheet({
  open,
  onClose,
  theaters,
  selectedTheater,
  onSelect,
}: Props) {
  const firstRowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstRowRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="sheet"
        role="dialog"
        aria-label="Filter by theater"
        aria-modal="true"
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-title">Filter by theater</div>

        <button
          ref={firstRowRef}
          className={`sheet-row${selectedTheater === "all" ? " sheet-row--active" : ""}`}
          onClick={() => { onSelect("all"); onClose(); }}
        >
          All theaters
          {selectedTheater === "all" && <span className="sheet-row-check">✓</span>}
        </button>

        {theaters.map((t) => (
          <button
            key={t.id}
            className={`sheet-row${selectedTheater === t.id ? " sheet-row--active" : ""}`}
            onClick={() => { onSelect(t.id); onClose(); }}
          >
            {t.name}
            {selectedTheater === t.id && <span className="sheet-row-check">✓</span>}
          </button>
        ))}
      </div>
    </>
  );
}
