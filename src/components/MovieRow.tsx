import type { AppState, TransformedMovie, TransformedShowtime } from "../types";
import MoviePoster from "./MoviePoster";
import TheaterCard from "./TheaterCard";

interface Props {
  movie: TransformedMovie;
  filters: Pick<AppState, "selectedDate" | "selectedLang" | "selectedTheater">;
}

function RatingPill({ rating }: { rating: number }) {
  const cls =
    rating >= 8 ? "rating-great" :
    rating >= 7 ? "rating-good" :
    rating >= 6 ? "rating-ok" :
    "rating-low";
  return <span className={`rating-pill ${cls}`}>★ {rating.toFixed(1)}</span>;
}

export default function MovieRow({ movie, filters }: Props) {
  const { selectedDate, selectedLang, selectedTheater } = filters;
  const imdbLink = movie.links.imdb;

  // Group showtimes by theater, applying all active filters
  const theaterMap = new Map<string, TransformedShowtime[]>();
  for (const s of movie.showtimes) {
    if (selectedDate !== "all" && s.dayOffset !== selectedDate) continue;
    if (selectedTheater !== "all" && s.theater.id !== selectedTheater) continue;
    if (selectedLang !== "all" && s.language !== selectedLang) continue;
    const arr = theaterMap.get(s.theater.id) ?? [];
    arr.push(s);
    theaterMap.set(s.theater.id, arr);
  }

  const theaterEntries = [...theaterMap.entries()];

  const shownGenres = movie.genres.slice(0, 3);
  const extraGenres = movie.genres.length - 3;

  const theaterCount = new Set(movie.showtimes.map((s) => s.theater.id)).size;
  const screeningCount = movie.showtimes.length;

  return (
    <article className="movie-row">
      <MoviePoster title={movie.title} posterUrl={movie.poster_url} />

      <div className="movie-row-content">
        <div className="info-top">
          <span className="movie-title">{movie.title}</span>
          {movie.year != null && <span className="movie-year">{movie.year}</span>}
          {movie.runtimeLabel && <span className="movie-runtime">{movie.runtimeLabel}</span>}
          {imdbLink && (
            <span className="ext-links">
              <a
                className="ext-link"
                href={imdbLink}
                target="_blank"
                rel="noreferrer"
                aria-label={`View details for ${movie.title} on IMDb (opens in a new tab)`}
              >
                <span className="ext-link-desktop">View on IMDb</span>
                <span className="ext-link-mobile" aria-hidden="true">IMDb ↗</span>
              </a>
            </span>
          )}
        </div>

        <div className="info-tags">
          {movie.rating != null && <RatingPill rating={movie.rating} />}
          {shownGenres.map((g) => (
            <span key={g} className="tag-genre">{g}</span>
          ))}
          {extraGenres > 0 && (
            <span className="tag-genre-overflow">+{extraGenres}</span>
          )}
        </div>

        <p className="availability-line">
          {theaterCount} {theaterCount === 1 ? "theater" : "theaters"} · {screeningCount} {screeningCount === 1 ? "screening" : "screenings"}
        </p>

        {movie.synopsis && <p className="synopsis">{movie.synopsis}</p>}

        <div className="showtimes-grid">
          {theaterEntries.map(([theaterId, times]) => (
            <TheaterCard key={theaterId} showtimes={times} selectedDate={selectedDate} />
          ))}
        </div>
      </div>
    </article>
  );
}
