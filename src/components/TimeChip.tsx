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
  return (
    <div className="time-chip">
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
