import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import type { TransformedShowtime, TransformedMovie } from "../types";
import type { Coords } from "../hooks/useLocationPin";
import { haversineKm } from "../utils";
import MoviePoster from "../components/MoviePoster";
import RatingPill from "../components/RatingPill";
import TheaterCard from "../components/TheaterCard";

interface Props {
  movies: TransformedMovie[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  coords: Coords | null;
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  );
}

function TheaterEntries({ movie, coords }: { movie: TransformedMovie; coords: Coords | null }) {
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
    <div className="showtimes-grid">
      {theaterEntries.map(({ times, distanceKm }) => (
        <TheaterCard key={times[0].theater.id} showtimes={times} distanceKm={distanceKm} />
      ))}
    </div>
  );
}

export default function FilmDetailView({ movies, loading, error, onRetry, coords }: Props) {
  const { id } = useParams<{ id: string }>();
  const movie = movies.find((m) => m.links.imdb_id === id);

  if (loading && !movie) {
    return (
      <div className="detail-loading">
        <div className="detail-body">
          <Link to="/" className="back-btn">← Back</Link>
          <div className="detail-skeleton-hero" />
          <div className="detail-skeleton-text" />
        </div>
      </div>
    );
  }

  if (error && !movie) {
    return (
      <div className="detail-error">
        <div className="detail-body">
          <Link to="/" className="back-btn">← Back</Link>
          <p className="detail-error-msg">Failed to load listings.</p>
          <button className="retry-btn" onClick={onRetry}>Try again</button>
        </div>
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="detail-not-found">
        <div className="detail-body">
          <Link to="/" className="back-btn">← Back</Link>
          <p>Film not found.</p>
        </div>
      </div>
    );
  }

  const shownGenres = movie.genres.slice(0, 4);

  const letterboxdHref = movie.links.imdb_id
    ? `https://letterboxd.com/imdb/${movie.links.imdb_id}/`
    : `https://letterboxd.com/search/${encodeURIComponent(`${movie.title}${movie.year != null ? ` ${movie.year}` : ""}`)}/`;
  const rtHref = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(`${movie.title}${movie.year != null ? ` ${movie.year}` : ""}`)}`;
  const metacriticHref = `https://www.metacritic.com/search/${encodeURIComponent(`${movie.title}${movie.year != null ? ` ${movie.year}` : ""}`)}/`;

  const hasBackdrop = !!movie.backdrop_url;

  return (
    <div className={`detail-page${hasBackdrop ? " detail-page--has-hero" : ""}`}>
      {hasBackdrop && (
        <div className="detail-hero">
          <img src={movie.backdrop_url!} alt="" className="detail-backdrop" />
          <div className="detail-hero-gradient" />
          <div className="detail-hero-nav">
            <div className="layout">
              <Link to="/" className="back-btn back-btn--hero">← Back</Link>
            </div>
          </div>
          <div className="detail-hero-content">
            <div className="detail-poster-overlay">
              <MoviePoster title={movie.title} posterUrl={movie.poster_url} />
            </div>
            <div className="detail-hero-text">
              <div className="detail-title-row">
                <h1 className="detail-hero-title">{movie.title}</h1>
                {movie.rating != null && <RatingPill rating={movie.rating} />}
              </div>
              <div className="detail-hero-meta">
                {movie.year != null && <span>{movie.year}</span>}
                {movie.runtimeLabel && <span>{movie.runtimeLabel}</span>}
                {shownGenres.map((g) => <span key={g} className="tag-genre tag-genre--hero">{g}</span>)}
              </div>
              {movie.trailer_url && (
                <a
                  className="trailer-btn"
                  href={movie.trailer_url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Watch ${movie.title} trailer on YouTube (opens in a new tab)`}
                >
                  <PlayIcon />
                  Watch Trailer
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="detail-body">
        {!hasBackdrop && <Link to="/" className="back-btn">← Back</Link>}

        {!hasBackdrop && (movie.poster_url ? (
          <div className="detail-poster-info-row">
            <img src={movie.poster_url} alt={movie.title} className="detail-poster-top" />
            <div className="detail-poster-info">
              <div className="detail-title-row">
                <h1 className="detail-title">{movie.title}</h1>
                {movie.rating != null && <RatingPill rating={movie.rating} />}
              </div>
              <div className="detail-meta">
                {movie.year != null && <span>{movie.year}</span>}
                {movie.runtimeLabel && <span>{movie.runtimeLabel}</span>}
                {shownGenres.map((g) => <span key={g} className="tag-genre">{g}</span>)}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="detail-title-row">
              <h1 className="detail-title">{movie.title}</h1>
              {movie.rating != null && <RatingPill rating={movie.rating} />}
            </div>
            <div className="detail-meta">
              {movie.year != null && <span>{movie.year}</span>}
              {movie.runtimeLabel && <span>{movie.runtimeLabel}</span>}
              {shownGenres.map((g) => <span key={g} className="tag-genre">{g}</span>)}
            </div>
          </>
        ))}

        {!hasBackdrop && movie.trailer_url && (
          <a
            className="trailer-btn"
            href={movie.trailer_url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Watch ${movie.title} trailer on YouTube (opens in a new tab)`}
          >
            <PlayIcon />
            Watch Trailer
          </a>
        )}

        {movie.synopsis && <p className="detail-synopsis">{movie.synopsis}</p>}

        <div className="detail-external-links">
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
          <a
            className="ext-link"
            href={rtHref}
            target="_blank"
            rel="noreferrer"
            aria-label={`Search ${movie.title} on Rotten Tomatoes (opens in a new tab)`}
          >
            <img src="/rt-favicon.ico" width="12" height="12" aria-hidden="true" />
            Rotten Tomatoes
          </a>
          <a
            className="ext-link"
            href={metacriticHref}
            target="_blank"
            rel="noreferrer"
            aria-label={`Search ${movie.title} on Metacritic (opens in a new tab)`}
          >
            <img src="/metacritic-favicon.ico" width="12" height="12" aria-hidden="true" />
            Metacritic
          </a>
        </div>

        {movie.showtimes.length > 0 && (
          <>
            <h2 className="detail-showtimes-heading">Showtimes</h2>
            <TheaterEntries movie={movie} coords={coords} />
          </>
        )}
      </div>
    </div>
  );
}
