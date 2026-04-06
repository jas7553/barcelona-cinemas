import type { TransformedShowtime } from "../types";

interface Props {
  showtime: TransformedShowtime;
}

export default function TimeChip({ showtime }: Props) {
  const now = new Date();
  const [y, mo, d] = showtime.date.split("-").map(Number);
  const [h, m] = showtime.time.split(":").map(Number);
  const showDatetime = new Date(y, mo - 1, d, h, m);

  if (showDatetime < now) return null;

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
