import { useEffect, useMemo, useRef, useState } from "react";
import FilmCard from "../components/FilmCard";
import BottomNav from "../components/BottomNav";
import { normalizeForSearch } from "../utils";
import type { TransformedMovie } from "../types";

interface Props {
  movies: TransformedMovie[];
  isActive: boolean;
  onFilmSelect: (movie: TransformedMovie) => void;
  onCancel: () => void;
}

function SearchIconSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-mute)" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export default function SearchScreen({ movies, isActive, onFilmSelect, onCancel }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isActive) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [isActive]);

  const results = useMemo(() => {
    const q = normalizeForSearch(query);
    if (!q) return movies;
    return movies.filter(
      (m) =>
        normalizeForSearch(m.title).includes(q) ||
        m.genres.some((g) => normalizeForSearch(g).includes(q)),
    );
  }, [movies, query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <div className="search-header">
        <div className="search-row">
          <div className="search-input-wrap">
            <SearchIconSmall />
            <input
              ref={inputRef}
              className="search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Film title, director, or actor…"
              aria-label="Search films"
            />
            {query.length > 0 && (
              <button
                className="search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          <button className="search-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>

        <div className="search-hint" aria-live="polite">
          {query.trim().length === 0
            ? "All films in English this week"
            : results.length === 0
              ? "No results"
              : `${results.length} film${results.length !== 1 ? "s" : ""} found`}
        </div>
        <div className="search-divider" />
      </div>

      <div className="film-list-scroll">
        {results.length > 0 ? (
          <div className="film-list">
            {results.map((m) => (
              <FilmCard key={m.id} movie={m} onSelect={onFilmSelect} />
            ))}
          </div>
        ) : query.trim().length > 0 ? (
          <div className="empty-state">
            <div className="empty-state__emoji">🎞</div>
            <div className="empty-state__heading">Nothing showing</div>
            <div className="empty-state__body">
              No English-language screenings match{" "}
              <em>"{query}"</em> this week.
            </div>
          </div>
        ) : null}
      </div>

      <BottomNav active="search" />
    </div>
  );
}
