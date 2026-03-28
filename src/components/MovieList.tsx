import type { Movie } from "../types";
import { isFuture } from "../utils";
import { MovieCard } from "./MovieCard";

interface Props {
  movies: Movie[];
  activeNeighborhood: string;
  loading: boolean;
  onShowAll: () => void;
}

export function MovieList({ movies, activeNeighborhood, loading, onShowAll }: Props) {
  if (loading) {
    return (
      <main id="movie-list">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card skeleton" aria-hidden="true">
            <div className="skeleton-title" />
            <div className="skeleton-meta" />
            <div className="skeleton-synopsis" />
          </div>
        ))}
      </main>
    );
  }

  const now = new Date();
  const filtered = filterAndSort(movies, activeNeighborhood, now);

  if (filtered.length === 0) {
    return (
      <main id="movie-list">
        {activeNeighborhood !== "All" ? (
          <p className="state-msg">
            No upcoming screenings near <strong>{activeNeighborhood}</strong>.{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); onShowAll(); }}>
              Show all cinemas →
            </a>
          </p>
        ) : (
          <p className="state-msg">
            No more screenings this week.
            <br />
            New listings typically arrive Monday.
          </p>
        )}
      </main>
    );
  }

  return (
    <main id="movie-list">
      {filtered.map((movie) => (
        <MovieCard key={movie.title} movie={movie} />
      ))}
    </main>
  );
}

function filterAndSort(movies: Movie[], neighborhood: string, now: Date): Movie[] {
  return movies
    .map((m) => ({
      ...m,
      showtimes: m.showtimes.filter(
        (s) => isFuture(s, now) && (neighborhood === "All" || s.neighborhood === neighborhood)
      ),
    }))
    .filter((m) => m.showtimes.length > 0)
    .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
}
