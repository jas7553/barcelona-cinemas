import { useState } from "react";
import { relativeTime } from "../utils";
import type { TransformedMovie } from "../types";
import type { Coords } from "../hooks/useGeolocation";
import EmptyState from "./EmptyState";
import MovieRow from "./MovieRow";

interface Props {
  movies: TransformedMovie[];
  allMoviesEmpty: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  generatedAt: string | null;
  stale: boolean;
  onHide: (id: string) => void;
  coords: Coords | null;
}

const SKELETON_COUNT = 5;

export default function MovieList({
  movies,
  allMoviesEmpty,
  loading,
  error,
  onRetry,
  generatedAt,
  stale,
  onHide,
  coords,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renderedAt] = useState(() => Date.now());

  const generatedTimestamp = generatedAt == null ? Number.NaN : Date.parse(generatedAt);
  const showStaleNotice =
    stale ||
    (Number.isFinite(generatedTimestamp) &&
      renderedAt - generatedTimestamp > 24 * 60 * 60 * 1000);

  if (loading) {
    return (
      <div className="movie-list" aria-hidden="true">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <div key={i} className="skeleton-row">
            <div className="skeleton-poster skeleton-block" />
            <div className="skeleton-content">
              <div className="skeleton-block skeleton-title" />
              <div className="skeleton-block skeleton-meta" />
              <div className="skeleton-block skeleton-synopsis" />
              <div className="skeleton-block skeleton-synopsis-2" />
              <div className="skeleton-block skeleton-chips" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-state">
        <div className="empty-icon">⚠️</div>
        <p className="empty-text">Couldn't load listings. Try refreshing.</p>
        <button className="retry-btn" onClick={onRetry}>Retry</button>
      </div>
    );
  }

  const footerMeta = generatedAt ? (
    <div className={`list-footer-meta${showStaleNotice ? " is-stale" : ""}`}>
      Listings last updated {relativeTime(generatedAt)}
    </div>
  ) : null;

  return (
    <>
      {movies.length === 0 ? (
        <>
          <EmptyState noListings={allMoviesEmpty} />
          {footerMeta}
        </>
      ) : (
        <>
          <div className="movie-list">
            {movies.map((m) => (
              <MovieRow
                key={m.id}
                movie={m}
                isExpanded={m.id === expandedId}
                onToggle={() => setExpandedId(m.id === expandedId ? null : m.id)}
                onHide={onHide}
                coords={coords}
              />
            ))}
          </div>
          {footerMeta}
        </>
      )}
    </>
  );
}
