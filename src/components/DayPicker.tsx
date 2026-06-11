import { useEffect, useRef } from "react";
import { generateDays } from "../utils";

interface Props {
  selectedDay: number | null;
  onSelect: (day: number | null) => void;
  activeDays?: Set<number>;
}

export default function DayPicker({ selectedDay, onSelect, activeDays }: Props) {
  const days = generateDays();
  const activeRef = useRef<HTMLButtonElement>(null);

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
    <div className="day-chips">
      <button
        className={`day-chip${selectedDay === null ? " day-chip--active" : ""}`}
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {days.map(({ label, offset }) => {
        const isActive = selectedDay === offset;
        const hasScreenings = !activeDays || activeDays.has(offset);
        return (
          <button
            key={offset}
            ref={isActive ? activeRef : undefined}
            className={`day-chip${isActive ? " day-chip--active" : ""}${!hasScreenings && !isActive ? " day-chip--faded" : ""}`}
            aria-label={!hasScreenings && !isActive ? `${label} — no screenings` : undefined}
            onClick={() => onSelect(isActive ? null : offset)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
