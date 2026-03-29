import type { AppState, Theater, TransformedMovie } from "../types";

interface Props {
  filters: AppState;
  onFilter: (key: keyof AppState, value: string) => void;
  genres: string[];
  theaters: Theater[];
  movies: TransformedMovie[];
}

export default function Sidebar({ filters, onFilter, genres, theaters, movies }: Props) {
  const { selectedLang, selectedGenre, selectedTheater, selectedDate } = filters;

  // Lang counts: respect theater+date filters but NOT lang filter
  let voCount = 0;
  let dubCount = 0;
  for (const m of movies) {
    let hasVo = false;
    let hasDub = false;
    for (const s of m.showtimes) {
      if (
        (selectedTheater === "all" || s.theater.id === selectedTheater) &&
        (selectedDate === "all" || s.dayOffset === selectedDate)
      ) {
        if (s.language === "vo") hasVo = true;
        else if (s.language === "dub") hasDub = true;
      }
    }
    if (hasVo) voCount++;
    if (hasDub) dubCount++;
  }

  const langOptions: Array<{ value: AppState["selectedLang"]; label: string; count?: number }> = [
    { value: "all", label: "All languages" },
    { value: "vo",  label: "VOSE",   count: voCount },
    { value: "dub", label: "Dubbed", count: dubCount },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="filter-section-label">Language</div>
        {langOptions.map(({ value, label, count }) => (
          <button
            key={value}
            className="sidebar-btn"
            aria-pressed={selectedLang === value}
            onClick={() => onFilter("selectedLang", value)}
          >
            <span>{label}</span>
            {count != null && (
              <span className="sidebar-btn-meta">{count}</span>
            )}
          </button>
        ))}
      </div>

      {theaters.length > 0 && (
        <div className="sidebar-section">
          <div className="filter-section-label">Theater</div>
          <button
            className="sidebar-btn"
            aria-pressed={selectedTheater === "all"}
            onClick={() => onFilter("selectedTheater", "all")}
          >
            All theaters
          </button>
          {theaters.map((t) => (
            <button
              key={t.id}
              className="sidebar-btn sidebar-btn-split"
              aria-pressed={selectedTheater === t.id}
              onClick={() => onFilter("selectedTheater", t.id)}
            >
              <span className="sidebar-btn-label">{t.name}</span>
              <span className="sidebar-btn-meta">{t.neighborhood}</span>
            </button>
          ))}
        </div>
      )}

      {genres.length > 0 && (
        <div className="sidebar-section">
          <div className="filter-section-label">Genre</div>
          <button
            className="sidebar-btn"
            aria-pressed={selectedGenre === "all"}
            onClick={() => onFilter("selectedGenre", "all")}
          >
            All genres
          </button>
          {genres.map((g) => (
            <button
              key={g}
              className="sidebar-btn"
              aria-pressed={selectedGenre === g}
              onClick={() => onFilter("selectedGenre", g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
