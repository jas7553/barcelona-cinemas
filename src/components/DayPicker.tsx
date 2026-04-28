import { generateDays } from "../utils";

interface Props {
  selectedDay: number | null;
  onSelect: (day: number | null) => void;
  activeDays?: Set<number>;
}

export default function DayPicker({ selectedDay, onSelect, activeDays }: Props) {
  const days = generateDays();

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
            className={`day-chip${isActive ? " day-chip--active" : ""}${!hasScreenings && !isActive ? " day-chip--faded" : ""}`}
            onClick={() => onSelect(isActive ? null : offset)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
