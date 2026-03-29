import type { AppState } from "../types";
import { formatDayLabel, formatDaySubLabel, todayAtMidnight } from "../utils";

interface Props {
  selectedDate: AppState["selectedDate"];
  onSelect: (date: AppState["selectedDate"]) => void;
}

export default function DateBar({ selectedDate, onSelect }: Props) {
  const today = todayAtMidnight();

  const tabs: Array<{ value: AppState["selectedDate"]; label: string; sub?: string; isAll?: boolean }> = [
    { value: "all", label: "All days", isAll: true },
  ];

  for (let i = 0; i <= 6; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const label = formatDayLabel(i, d);
    const sub = i >= 2 ? formatDaySubLabel(d) : undefined;
    tabs.push({ value: i, label, sub });
  }

  return (
    <div className="date-bar" role="tablist" aria-label="Filter by day">
      {tabs.map((tab) => (
        <button
          key={String(tab.value)}
          role="tab"
          className={`date-tab${tab.isAll ? " all-days" : ""}`}
          aria-selected={selectedDate === tab.value}
          onClick={() => onSelect(tab.value)}
        >
          {tab.label}
          {tab.sub && <span className="ds">{tab.sub}</span>}
        </button>
      ))}
    </div>
  );
}
