import { useMemo, useState } from "react";
import type { SharedProps } from "../App";
import { normalizeForSearch, smartSort } from "../utils";
import type { Coords } from "../hooks/useLocationPin";
import Header from "../components/Header";
import MovieList from "../components/MovieList";
import Footer from "../components/Footer";

interface Props extends SharedProps {
  coords: Coords | null;
  locationPin: {
    active: boolean;
    error: boolean;
    onToggle: () => void;
  };
}

export default function ShowtimesView({
  movies,
  generatedAt,
  stale,
  loading,
  error,
  onRetry,
  hiddenIds,
  onHide,
  onClearHidden,
  coords,
  locationPin,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredMovies = useMemo(() => {
    const q = normalizeForSearch(searchQuery);
    const searched = q
      ? movies.filter((m) => normalizeForSearch(m.title).includes(q))
      : movies;
    return smartSort(searched, hiddenIds);
  }, [movies, searchQuery, hiddenIds]);

  const statusMessage = loading
    ? "Loading movie listings."
    : error
      ? "Could not load movie listings."
      : `${filteredMovies.length} ${filteredMovies.length === 1 ? "film" : "films"} shown.`;

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to listings</a>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </div>

      <Header searchQuery={searchQuery} onSearch={setSearchQuery} locationPin={locationPin} />

      <div className="layout">
        <main id="main-content" aria-labelledby="page-title" aria-busy={loading}>
          <h1 className="sr-only" id="page-title">Barcelona English-language cinema listings</h1>
          <MovieList
            movies={filteredMovies}
            allMoviesEmpty={movies.length === 0}
            loading={loading}
            error={error}
            onRetry={onRetry}
            generatedAt={generatedAt}
            stale={stale}
            onHide={onHide}
            coords={coords}
          />
        </main>
      </div>

      <Footer hiddenCount={hiddenIds.size} onClearHidden={onClearHidden} />
    </>
  );
}
