import type { TransformedShowtime } from "../types";

interface Props {
  showtime: TransformedShowtime;
}

export default function TimeChip({ showtime }: Props) {
  return (
    <a
      className="time-chip"
      href={showtime.theater.website_url || "#"}
      target="_blank"
      rel="noreferrer"
      aria-label={`Book ${showtime.time} at ${showtime.theater.name} (opens in a new tab)`}
    >
      {showtime.time}
    </a>
  );
}
