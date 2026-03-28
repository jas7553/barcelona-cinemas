import { useState } from "react";
import type { Showtime } from "../types";
import { dateLabel } from "../utils";

const SHOW_LIMIT = 3;

interface Props {
  showtimes: Showtime[];
}

export function ShowtimesBlock({ showtimes }: Props) {
  const [expanded, setExpanded] = useState(false);

  const rows = groupByDate(showtimes);
  const visible = expanded ? rows : rows.slice(0, SHOW_LIMIT);
  const extra = rows.length - SHOW_LIMIT;

  return (
    <div className="showtimes">
      {visible.map(([label, times]) => (
        <div key={label} className="showtime-row">
          <span className="show-date">{label}</span>
          <span className="show-times">
            {times.map((s, i) => (
              <span key={i} className="show-pill">
                <span className="time">{s.time}</span>
                <span className="cinema">{s.cinema}</span>
              </span>
            ))}
          </span>
        </div>
      ))}
      {extra > 0 && (
        <button className="showmore-btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : `+${extra} more`}
        </button>
      )}
    </div>
  );
}

function groupByDate(showtimes: Showtime[]): [string, Showtime[]][] {
  const map = new Map<string, Showtime[]>();
  for (const s of showtimes) {
    const label = dateLabel(s.date);
    const group = map.get(label) ?? [];
    group.push(s);
    map.set(label, group);
  }
  return [...map.entries()];
}
