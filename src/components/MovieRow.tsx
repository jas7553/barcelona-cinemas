import { useState } from "react";
import { Link } from "react-router-dom";
import type { TransformedMovie } from "../types";
import MoviePoster from "./MoviePoster";
import RatingPill from "./RatingPill";

interface Props {
  movie: TransformedMovie;
  index?: number;
  onHide: (id: string) => void;
}

export default function MovieRow({ movie, index = 0, onHide }: Props) {
  const [hiding, setHiding] = useState(false);
  const isLastChance = movie.showtimes.every((s) => s.dayOffset <= 1);
  const shownGenres = movie.genres.slice(0, 3);

  const letterboxdHref = movie.links.imdb_id
    ? `https://letterboxd.com/imdb/${movie.links.imdb_id}/`
    : `https://letterboxd.com/search/${encodeURIComponent(`${movie.title}${movie.year != null ? ` ${movie.year}` : ""}`)}/`;

  function handleHide(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    setHiding(true);
    setTimeout(() => onHide(movie.id), 210);
  }

  const animationDelay = index < 8 ? `${index * 35}ms` : undefined;

  const content = (
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
              onClick={handleHide}
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

        <div className="movie-external-links" onClick={(e) => e.stopPropagation()}>
          {movie.links.imdb && (
            <a
              className="ext-link"
              href={movie.links.imdb}
              target="_blank"
              rel="noreferrer"
              aria-label={`${movie.title} on IMDb (opens in a new tab)`}
            >
              <img src="/imdb-favicon.png" width="12" height="12" aria-hidden="true" />
              IMDb
            </a>
          )}
          <a
            className="ext-link"
            href={letterboxdHref}
            target="_blank"
            rel="noreferrer"
            aria-label={`${movie.title} on Letterboxd (opens in a new tab)`}
          >
            <img src="/letterboxd-favicon.ico" width="12" height="12" aria-hidden="true" />
            Letterboxd
          </a>
        </div>
      </div>
    </div>
  );

  const className = `movie-row${hiding ? " movie-row--hiding" : ""}`;
  const style = animationDelay ? { animationDelay } : undefined;

  if (movie.links.imdb_id) {
    return (
      <Link
        to={`/film/${movie.links.imdb_id}`}
        id={`film-${movie.id}`}
        className={className}
        style={style}
        role="article"
        onClick={(e) => { if (window.getSelection()?.toString()) e.preventDefault(); }}
      >
        {content}
      </Link>
    );
  }

  return (
    <article id={`film-${movie.id}`} className={className} style={style} role="article">
      {content}
    </article>
  );
}
