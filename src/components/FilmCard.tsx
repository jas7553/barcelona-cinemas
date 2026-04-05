import { useState } from "react";
import { Link } from "react-router-dom";
import type { FilmDiscovery } from "../types";
import FilmBadge from "./FilmBadge";

interface Props {
  film: FilmDiscovery;
  defaultExpanded?: boolean;
}

function RatingPill({ rating }: { rating: number }) {
  const cls =
    rating >= 8 ? "rating-great" :
    rating >= 7 ? "rating-good" :
    rating >= 6 ? "rating-ok" :
    "rating-low";
  return <span className={`rating-pill ${cls}`}>★ {rating.toFixed(1)}</span>;
}

export default function FilmCard({ film, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const shownGenres = film.genres.slice(0, 3);
  const extraGenres = film.genres.length - 3;

  return (
    <div className="film-card">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
      >
        <div className="film-card-poster-wrap">
          {film.poster_url ? (
            <img
              className="film-card-poster"
              src={film.poster_url}
              alt={film.title}
              loading="lazy"
            />
          ) : (
            <div className="film-card-poster-placeholder">{film.title}</div>
          )}
          <FilmBadge film={film} />
        </div>

        <div className="film-card-body">
          <p className="film-card-title">{film.title}</p>
          <p className="film-card-meta">
            {[film.year, film.runtimeLabel].filter(Boolean).join(" · ")}
          </p>
          {film.rating != null && <RatingPill rating={film.rating} />}
          <div className="film-card-genres">
            {shownGenres.map((g) => (
              <span key={g} className="tag-genre">{g}</span>
            ))}
            {extraGenres > 0 && <span className="tag-genre-overflow">+{extraGenres}</span>}
          </div>
          <p className="film-card-avail">
            {film.theaterCount} {film.theaterCount === 1 ? "theater" : "theaters"} · {film.screeningCount} {film.screeningCount === 1 ? "screening" : "screenings"}
          </p>
        </div>
      </div>

      {expanded && (
        <div className="film-card-expanded">
          {film.synopsis && <p className="film-card-synopsis">{film.synopsis}</p>}
          {film.availableDays.length > 0 && (
            <div className="film-card-days">
              {film.availableDays.map((d) => (
                <span key={d} className="day-chip">{d}</span>
              ))}
            </div>
          )}
          <div className="film-card-actions">
            {film.links.imdb && (
              <a
                className="imdb-btn"
                href={film.links.imdb}
                target="_blank"
                rel="noreferrer"
                aria-label={`View ${film.title} on IMDb`}
                onClick={(e) => e.stopPropagation()}
              >
                IMDb ↗
              </a>
            )}
            <Link
              to={`/showtimes?film=${film.id}`}
              className="showtimes-cta"
              onClick={(e) => e.stopPropagation()}
            >
              See showtimes →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
