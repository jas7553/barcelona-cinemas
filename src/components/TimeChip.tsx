import type { TransformedShowtime } from "../types";

interface Props {
  showtime: TransformedShowtime;
}

export default function TimeChip({ showtime }: Props) {
  const isPast = new Date(`${showtime.date}T${showtime.time}`) <= new Date();
  return (
    <span className={`time-chip${isPast ? " time-chip--past" : ""}`}>
      {showtime.time}
    </span>
  );
}
