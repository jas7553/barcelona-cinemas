import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SharedProps } from "../App";
import { normalizeForSearch, smartSort } from "../utils";
import Header from "../components/Header";
import MovieList from "../components/MovieList";
import Footer from "../components/Footer";

interface Props extends SharedProps {
  locationPin: {
    active: boolean;
    error: boolean;
    onToggle: () => void;
  };
}

type DayFilter = "all" | 0 | 1;

function parseDayFilter(raw: string | null): DayFilter {
  if (raw === "0") return 0;
  if (raw === "1") return 1;
  return "all";
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
  locationPin,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [groupLastChance, setGroupLastChance] = useState(false);

  const dayFilter = parseDayFilter(searchParams.get("day"));

  function setDayFilter(v: DayFilter) {
    setSearchParams(v === "all" ? {} : { day: String(v) }, { replace: true });
  }

  const filteredMovies = useMemo(() => {
    const q = normalizeForSearch(searchQuery);
    let result = q
      ? movies.filter(
          (m) =>
            normalizeForSearch(m.title).includes(q) ||
            m.genres.some((g) => normalizeForSearch(g).includes(q))
        )
      : movies;
    if (dayFilter !== "all") {
      result = result.filter((m) => m.showtimes.some((s) => s.dayOffset === dayFilter));
    }
    return smartSort(result, hiddenIds, groupLastChance);
  }, [movies, searchQuery, hiddenIds, groupLastChance, dayFilter]);

  const statusMessage = loading
    ? "Loading movie listings."
    : error
      ? "Could not load movie listings."
      : `${filteredMovies.length} ${filteredMovies.length === 1 ? "film" : "films"} shown.`;

  const hiddenCount = hiddenIds.size;

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to listings</a>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </div>

      <Header
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        locationPin={locationPin}
        lastChance={{ active: groupLastChance, onToggle: () => setGroupLastChance((v) => !v) }}
      />

      <div className="layout">
        <main id="main-content" aria-labelledby="page-title" aria-busy={loading}>
          <h1 className="sr-only" id="page-title">Barcelona English-language cinema listings</h1>

          <div className="toolbar">
            <div className="day-filter-bar" role="group" aria-label="Filter by day">
              {(["all", 0, 1] as DayFilter[]).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  className={`day-filter-btn${dayFilter === v ? " is-active" : ""}`}
                  onClick={() => setDayFilter(v)}
                  aria-pressed={dayFilter === v}
                >
                  {v === "all" ? "All" : v === 0 ? "Today" : "Tomorrow"}
                </button>
              ))}
            </div>

            {hiddenCount > 0 && (
              <button className="hidden-notice" onClick={onClearHidden}>
                {hiddenCount} hidden — restore
              </button>
            )}
          </div>

          <MovieList
            movies={filteredMovies}
            allMoviesEmpty={movies.length === 0}
            loading={loading}
            error={error}
            onRetry={onRetry}
            generatedAt={generatedAt}
            stale={stale}
            onHide={onHide}
          />
        </main>
      </div>

      <Footer />
    </>
  );
}
