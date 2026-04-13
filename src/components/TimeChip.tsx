import type { TransformedShowtime } from "../types";

interface Props {
  showtime: TransformedShowtime;
}

export default function TimeChip({ showtime }: Props) {
  return (
    <span className="time-chip">
      {showtime.time}
    </span>
  );
}
