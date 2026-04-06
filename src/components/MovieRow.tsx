import type { TransformedMovie, TransformedShowtime } from "../types";
import type { Coords } from "../hooks/useGeolocation";
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
  const isLastChance = movie.showtimes.length <= 2;
  const shownGenres = movie.genres.slice(0, 3);

  // Group showtimes by theater
  const theaterMap = new Map<string, TransformedShowtime[]>();
  for (const s of movie.showtimes) {
    const arr = theaterMap.get(s.theater.id) ?? [];
    arr.push(s);
    theaterMap.set(s.theater.id, arr);
  }

  // Sort theaters by distance if coords available, else alphabetically
  const theaterEntries = [...theaterMap.entries()].sort(([, aShowtimes], [, bShowtimes]) => {
    const aTheater = aShowtimes[0].theater;
    const bTheater = bShowtimes[0].theater;
    if (coords && aTheater.lat != null && aTheater.lng != null && bTheater.lat != null && bTheater.lng != null) {
      const aDist = haversineKm(coords.lat, coords.lng, aTheater.lat, aTheater.lng);
      const bDist = haversineKm(coords.lat, coords.lng, bTheater.lat, bTheater.lng);
      return aDist - bDist;
    }
    return aTheater.name.localeCompare(bTheater.name);
  });

  return (
    <article
      id={`film-${movie.id}`}
      className="movie-row"
      onClick={onToggle}
      role="article"
      aria-expanded={isExpanded}
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
        </div>
      </div>

      {isExpanded && (
        <div className="movie-row-expanded">
          {movie.synopsis && <p className="synopsis">{movie.synopsis}</p>}
          <div className="showtimes-grid">
            {theaterEntries.map(([theaterId, times]) => {
              const theater = times[0].theater;
              const distanceKm =
                coords && theater.lat != null && theater.lng != null
                  ? haversineKm(coords.lat, coords.lng, theater.lat, theater.lng)
                  : null;
              return (
                <TheaterCard key={theaterId} showtimes={times} distanceKm={distanceKm} />
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
