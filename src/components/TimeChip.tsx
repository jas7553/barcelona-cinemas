import type { TransformedShowtime } from "../types";

interface Props {
  showtime: TransformedShowtime;
}

const LANG_META = {
  vo:  { label: "VOSE", title: "Original version with subtitles" },
  dub: { label: "DUB",  title: "Dubbed in Spanish" },
};

export default function TimeChip({ showtime }: Props) {
  const lang = LANG_META[showtime.language];

  const now = new Date();
  const [y, mo, d] = showtime.date.split("-").map(Number);
  const [h, m] = showtime.time.split(":").map(Number);
  const showDatetime = new Date(y, mo - 1, d, h, m);
  const isPast = showDatetime < now;

  return (
    <div
      className={`time-chip${isPast ? " time-chip--past" : ""}`}
      aria-hidden={isPast ? "true" : undefined}
    >
      <span className="time-chip-time">{showtime.time}</span>
      {lang ? (
        <span className={`time-chip-lang ${showtime.language}`} title={lang.title}>
          {lang.label}
        </span>
      ) : (
        <span className="time-chip-lang unknown">{showtime.language}</span>
      )}
    </div>
  );
}
