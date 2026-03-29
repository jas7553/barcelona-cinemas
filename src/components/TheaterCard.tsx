import type { TransformedShowtime } from "../types";
import { formatDayLabel, todayAtMidnight } from "../utils";
import TimeChip from "./TimeChip";

interface Props {
  showtimes: TransformedShowtime[];  // pre-filtered to this theater
  selectedDate: "all" | number;
}

export default function TheaterCard({ showtimes, selectedDate }: Props) {
  if (showtimes.length === 0) return null;
  const theater = showtimes[0].theater;

  const body =
    selectedDate === "all" ? (
      <AllDaysBody showtimes={showtimes} />
    ) : (
      <div className="times-wrap">
        {showtimes.map((s, i) => <TimeChip key={i} showtime={s} />)}
      </div>
    );

  return (
    <div className="theater-card">
      <div className="tcard-head">
        <a className="tcard-name" href={theater.website_url} target="_blank" rel="noreferrer">
          {theater.name}
        </a>
        <span className="tcard-neighborhood">{theater.neighborhood}</span>
        {theater.maps_url && (
          <a
            className="tcard-map"
            href={theater.maps_url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${theater.name} in Google Maps`}
          >
            📍
          </a>
        )}
      </div>
      {body}
    </div>
  );
}

function AllDaysBody({ showtimes }: { showtimes: TransformedShowtime[] }) {
  const byDay = new Map<number, TransformedShowtime[]>();
  for (const s of showtimes) {
    const arr = byDay.get(s.dayOffset) ?? [];
    arr.push(s);
    byDay.set(s.dayOffset, arr);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a - b);

  const today = todayAtMidnight();

  return (
    <div className="day-rows">
      {days.map(([offset, times]) => {
        const date = new Date(today);
        date.setDate(today.getDate() + offset);
        const label = formatDayLabel(offset, date);
        return (
          <div className="day-row" key={offset}>
            <span className={`day-label${offset === 0 ? " today" : ""}`}>{label}</span>
            <div className="times-wrap">
              {times.map((s, i) => <TimeChip key={i} showtime={s} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
