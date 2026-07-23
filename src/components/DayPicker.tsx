import { useEffect, useRef } from "react";

interface Props {
  selectedDay: number | null;
  onSelect: (day: number | null) => void;
  activeDays?: Set<number>;
  /** Day chips, computed by the page from its shared `now` (SSG/hydration parity). */
  days: Array<{ label: string; fullLabel: string; offset: number }>;
  /**
   * Drop days with no screenings entirely instead of fading them. The film page
   * shows a single film, so a week of dead chips is pure scaffolding; the list
   * page keeps the full week (different films play different days).
   */
  hideInactive?: boolean;
}

export default function DayPicker({ selectedDay, onSelect, activeDays, days, hideInactive }: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const shownDays =
    hideInactive && activeDays
      ? days.filter(({ offset }) => activeDays.has(offset) || selectedDay === offset)
      : days;

  // Deep links like /?day=5 select a chip that sits offscreen in the
  // scrollable row — bring it into view. Scroll the row only, by hand:
  // scrollIntoView also scrolls the page vertically, which would clobber
  // the list scroll restoration.
  useEffect(() => {
    const el = activeRef.current;
    const row = el?.parentElement;
    if (!el || !row) return;
    if (el.offsetLeft < row.scrollLeft || el.offsetLeft + el.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = el.offsetLeft - 16;
    }
  }, [selectedDay]);

  return (
    <div className="day-chips" role="group" aria-label="Filter showtimes by day">
      <button
        className={`day-chip${selectedDay === null ? " day-chip--active" : ""}`}
        aria-pressed={selectedDay === null}
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {shownDays.map(({ label, offset }) => {
        const isActive = selectedDay === offset;
        const hasScreenings = !activeDays || activeDays.has(offset);
        // A chip for a day with nothing on is a dead end — selecting it writes
        // ?day=N that the page rejects, leaving the URL lying about the view.
        const isDisabled = !hasScreenings && !isActive;
        return (
          // aria-disabled, not disabled: a natively disabled chip leaves the tab
          // order, so the "no screenings" reason is never announced. The chip
          // stays focusable; the undefined onClick is what inerts it (Enter/Space
          // included).
          <button
            key={offset}
            ref={isActive ? activeRef : undefined}
            className={`day-chip${isActive ? " day-chip--active" : ""}${isDisabled ? " day-chip--faded" : ""}`}
            aria-label={isDisabled ? `${label} — no screenings` : undefined}
            aria-pressed={isActive}
            aria-disabled={isDisabled || undefined}
            onClick={isDisabled ? undefined : () => onSelect(isActive ? null : offset)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
