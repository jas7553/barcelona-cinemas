import type { TransformedShowtime } from "../types";
import { formatDayLabel, todayAtMidnight } from "../utils";
import TimeChip from "./TimeChip";

interface Props {
  showtimes: TransformedShowtime[];
  distanceKm: number | null;
}

export default function TheaterCard({ showtimes, distanceKm }: Props) {
  if (showtimes.length === 0) return null;
  const theater = showtimes[0].theater;

  const byDay = new Map<number, TransformedShowtime[]>();
  for (const s of showtimes) {
    const arr = byDay.get(s.dayOffset) ?? [];
    arr.push(s);
    byDay.set(s.dayOffset, arr);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a - b);

  const today = todayAtMidnight();

  return (
    <div className="theater-card">
      <div className="tcard-head">
        <span className="tcard-name">{theater.name}</span>
        <span className="tcard-neighborhood">{theater.neighborhood}</span>
        <span className="tcard-links">
          {theater.website_url && (
            <a
              className="tcard-link"
              href={theater.website_url}
              target="_blank"
              rel="noreferrer"
              aria-label={`${theater.name} website`}
              onClick={(e) => e.stopPropagation()}
            >
              Site
            </a>
          )}
          {theater.maps_url && (
            <a
              className="tcard-link"
              href={theater.maps_url}
              target="_blank"
              rel="noreferrer"
              aria-label={`${theater.name} — open in Google Maps`}
              onClick={(e) => e.stopPropagation()}
            >
              Map
            </a>
          )}
        </span>
        {distanceKm !== null && (
          <span className="tcard-distance">{distanceKm.toFixed(1)} km</span>
        )}
      </div>
      <div className="day-rows">
        {days.map(([offset, times]) => {
          const date = new Date(today);
          date.setDate(today.getDate() + offset);
          const label = formatDayLabel(offset, date);
          return (
            <div className="day-row" key={offset}>
              <span className={`day-label${offset === 0 ? " today" : ""}`}>{label}</span>
              <div className="times-wrap">{times.map((s, i) => <TimeChip key={i} showtime={s} />)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
