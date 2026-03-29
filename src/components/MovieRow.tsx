import type { AppState, TransformedMovie, TransformedShowtime } from "../types";
import TheaterCard from "./TheaterCard";

interface Props {
  movie: TransformedMovie;
  filters: Pick<AppState, "selectedDate" | "selectedLang" | "selectedTheater">;
}

export default function MovieRow({ movie, filters }: Props) {
  const { selectedDate, selectedLang, selectedTheater } = filters;

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

  return (
    <article className="movie-row">
      <div className="info-top">
        <span className="movie-title">{movie.title}</span>
        {movie.year != null && <span className="movie-year">{movie.year}</span>}
        {movie.runtimeLabel && <span className="movie-runtime">{movie.runtimeLabel}</span>}
        {(movie.links.imdb || movie.links.letterboxd || movie.links.filmaffinity) && (
          <span className="ext-links">
            {movie.links.imdb && (
              <a className="ext-link" href={movie.links.imdb} target="_blank" rel="noreferrer">IMDb</a>
            )}
            {movie.links.letterboxd && (
              <a className="ext-link" href={movie.links.letterboxd} target="_blank" rel="noreferrer">Letterboxd</a>
            )}
            {movie.links.filmaffinity && (
              <a className="ext-link" href={movie.links.filmaffinity} target="_blank" rel="noreferrer">FA</a>
            )}
          </span>
        )}
      </div>

      <div className="info-tags">
        {movie.rating != null && (
          <span className="tag tag-rating">★ {movie.rating.toFixed(1)}</span>
        )}
        {movie.genres.map((g) => (
          <span key={g} className="tag tag-genre">{g}</span>
        ))}
      </div>

      {movie.synopsis && <p className="synopsis">{movie.synopsis}</p>}

      <div className="showtimes-grid">
        {theaterEntries.map(([theaterId, times]) => (
          <TheaterCard key={theaterId} showtimes={times} selectedDate={selectedDate} />
        ))}
      </div>
    </article>
  );
}
