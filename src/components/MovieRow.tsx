import { useNavigate } from "react-router-dom";
import type { TransformedMovie } from "../types";
import MoviePoster from "./MoviePoster";
import RatingPill from "./RatingPill";

interface Props {
  movie: TransformedMovie;
  onHide: (id: string) => void;
}

export default function MovieRow({ movie, onHide }: Props) {
  const navigate = useNavigate();
  const isLastChance = movie.showtimes.length === 1;
  const shownGenres = movie.genres.slice(0, 3);

  const handleClick = () => {
    if (window.getSelection()?.toString()) return;
    if (movie.links.imdb_id) {
      void navigate(`/film/${movie.links.imdb_id}`);
    }
  };

  return (
    <article
      id={`film-${movie.id}`}
      className={`movie-row${movie.links.imdb_id ? "" : " movie-row--no-link"}`}
      role="article"
      onClick={handleClick}
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
            </div>
          </div>

          <div className="movie-meta">
            {movie.rating != null && <RatingPill rating={movie.rating} />}
            {shownGenres.map((g) => <span key={g} className="tag-genre">{g}</span>)}
          </div>

          {movie.synopsis && (
            <p className="synopsis-preview">{movie.synopsis}</p>
          )}
        </div>
      </div>
    </article>
  );
}
