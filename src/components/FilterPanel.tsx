import { useEffect } from "react";
import type { AppState, Theater } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  filters: AppState;
  onFilter: (key: keyof AppState, value: string) => void;
  genres: string[];
  theaters: Theater[];
}

const LANG_OPTIONS: Array<{ value: AppState["selectedLang"]; label: string }> = [
  { value: "all", label: "All" },
  { value: "vo",  label: "VOSE" },
  { value: "dub", label: "Dubbed" },
];

export default function FilterPanel({ open, onClose, filters, onFilter, genres, theaters }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="filter-panel open" id="mobile-filter-panel">
      <div role="group" aria-labelledby="mobile-filter-language-label">
        <div className="filter-section-label" id="mobile-filter-language-label">Language</div>
        <div className="filter-chips">
          {LANG_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              className="filter-chip"
              aria-pressed={filters.selectedLang === value}
              onClick={() => onFilter("selectedLang", value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {theaters.length > 0 && (
        <div role="group" aria-labelledby="mobile-filter-theater-label">
          <div className="filter-section-label" id="mobile-filter-theater-label">Theater</div>
          <div className="filter-chips">
            <button
              className="filter-chip"
              aria-pressed={filters.selectedTheater === "all"}
              onClick={() => onFilter("selectedTheater", "all")}
            >
              All
            </button>
            {theaters.map((t) => (
              <button
                key={t.id}
                className="filter-chip"
                aria-pressed={filters.selectedTheater === t.id}
                onClick={() => onFilter("selectedTheater", t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {genres.length > 0 && (
        <div role="group" aria-labelledby="mobile-filter-genre-label">
          <div className="filter-section-label" id="mobile-filter-genre-label">Genre</div>
          <div className="filter-chips">
            <button
              className="filter-chip"
              aria-pressed={filters.selectedGenre === "all"}
              onClick={() => onFilter("selectedGenre", "all")}
            >
              All
            </button>
            {genres.map((g) => (
              <button
                key={g}
                className="filter-chip"
                aria-pressed={filters.selectedGenre === g}
                onClick={() => onFilter("selectedGenre", g)}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
