import { useMemo } from "react";
import type { TransformedMovie, TransformedShowtime } from "../types";
import type { Coords } from "../hooks/useLocationPin";
import { haversineKm } from "../utils";
import MoviePoster from "./MoviePoster";
import TheaterCard from "./TheaterCard";

interface Props {
  movie: TransformedMovie;
  isExpanded: boolean;
  onToggle: () => void;
  onHide: (id: string) => void;
  coords: Coords | null;
}

function RatingPill({ rating }: { rating: number }) {
  return <span className="rating-pill">★ {rating.toFixed(1)}</span>;
}

export default function MovieRow({ movie, isExpanded, onToggle, onHide, coords }: Props) {
  const isLastChance = movie.showtimes.length === 1;
  const shownGenres = movie.genres.slice(0, 3);

  const handleToggle = () => {
    if (window.getSelection()?.toString()) return;
    onToggle();
  };

  // Group by theater, compute each distance once, then sort by distance or name.
  const theaterEntries = useMemo(() => {
    const theaterMap = new Map<string, TransformedShowtime[]>();
    for (const s of movie.showtimes) {
      const arr = theaterMap.get(s.theater.id) ?? [];
      arr.push(s);
      theaterMap.set(s.theater.id, arr);
    }
    return [...theaterMap.values()]
      .map((times) => {
        const theater = times[0].theater;
        const distanceKm =
          coords && theater.lat != null && theater.lng != null
            ? haversineKm(coords.lat, coords.lng, theater.lat, theater.lng)
            : null;
        return { times, distanceKm };
      })
      .sort((a, b) => {
        if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
        return a.times[0].theater.name.localeCompare(b.times[0].theater.name);
      });
  }, [movie.showtimes, coords]);

  return (
    <article
      id={`film-${movie.id}`}
      className="movie-row"
      role="article"
      aria-expanded={isExpanded}
      onClick={handleToggle}
      style={{ cursor: "pointer" }}
    >
      <div className="movie-row-collapsed">
        <div className="movie-poster-wrap" data-testid="poster-wrap">
          <MoviePoster title={movie.title} posterUrl={movie.poster_url} />
          {isLastChance && <span className="last-chance-badge" aria-label="Last chance to see this film">Last Chance</span>}
        </div>

        <div className="movie-row-content">
          <div className="movie-row-top">
            <div>
              <span className="movie-title">{movie.title}</span>
              {movie.year != null && <span className="movie-year"> · {movie.year}</span>}
              {movie.runtimeLabel && <span className="movie-runtime"> · {movie.runtimeLabel}</span>}
            </div>
            <div className="movie-row-actions">
              <button
                className="hide-btn"
                aria-label={`Hide ${movie.title}`}
                onClick={(e) => { e.stopPropagation(); onHide(movie.id); }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </button>
              <span
                className={`expand-chevron${isExpanded ? " is-expanded" : ""}`}
                data-testid="expand-chevron"
                aria-hidden="true"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </div>
          </div>

          <div className="movie-meta">
            {movie.rating != null && <RatingPill rating={movie.rating} />}
            {shownGenres.map((g) => <span key={g} className="tag-genre">{g}</span>)}
          </div>
          <div className="movie-external-links">
            {movie.links.imdb && (
              <a
                className="ext-link"
                href={movie.links.imdb}
                target="_blank"
                rel="noreferrer"
                aria-label={`${movie.title} on IMDb (opens in a new tab)`}
                onClick={(e) => e.stopPropagation()}
              >
                <img src="https://www.imdb.com/favicon.ico" width="12" height="12" aria-hidden="true" />
                IMDb
              </a>
            )}
            <a
              className="ext-link"
              href={`https://letterboxd.com/search/${encodeURIComponent(`${movie.title}${movie.year != null ? ` ${movie.year}` : ""}`)}/`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Search ${movie.title} on Letterboxd (opens in a new tab)`}
              onClick={(e) => e.stopPropagation()}
            >
              <img src="https://letterboxd.com/favicon.ico" width="12" height="12" aria-hidden="true" />
              Letterboxd
            </a>
          </div>
          {!isExpanded && movie.synopsis && (
            <p className="synopsis-preview">{movie.synopsis}</p>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="movie-row-expanded" onClick={(e) => e.stopPropagation()}>
          {movie.synopsis && <p className="synopsis">{movie.synopsis}</p>}
          <div className="showtimes-grid">
            {theaterEntries.map(({ times, distanceKm }) => (
              <TheaterCard key={times[0].theater.id} showtimes={times} distanceKm={distanceKm} />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
