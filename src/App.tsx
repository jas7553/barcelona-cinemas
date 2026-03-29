import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchListings } from "./api";
import type { AppState, Theater, TransformedMovie } from "./types";
import { normalizeForSearch, transformResponse } from "./utils";
import DateBar from "./components/DateBar";
import FilterPanel from "./components/FilterPanel";
import Header from "./components/Header";
import MovieList from "./components/MovieList";
import Sidebar from "./components/Sidebar";

const INITIAL_STATE: AppState = {
  selectedDate: "all",
  selectedLang: "all",
  selectedGenre: "all",
  selectedTheater: "all",
  searchQuery: "",
  filterPanelOpen: false,
};

export default function App() {
  const [movies, setMovies] = useState<TransformedMovie[]>([]);
  const [theaters, setTheaters] = useState<Theater[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AppState>(INITIAL_STATE);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchListings()
      .then((data) => {
        setMovies(transformResponse(data));
        setTheaters(data.theaters);
        setGeneratedAt(data.generated_at);
        setStale(data.stale);
      })
      .catch(() => setError("fetch failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchListings()
      .then((data) => {
        if (cancelled) return;
        setMovies(transformResponse(data));
        setTheaters(data.theaters);
        setGeneratedAt(data.generated_at);
        setStale(data.stale);
      })
      .catch(() => {
        if (!cancelled) setError("fetch failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setFilter = useCallback((key: keyof AppState, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);

  const toggleFilterPanel = useCallback(() => {
    setFilters((f) => ({ ...f, filterPanelOpen: !f.filterPanelOpen }));
  }, []);

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const m of movies) for (const g of m.genres) set.add(g);
    return [...set].sort();
  }, [movies]);

  const filteredMovies = useMemo(() => {
    const q = normalizeForSearch(filters.searchQuery);
    return movies.filter((m) => {
      if (q && !normalizeForSearch(m.title).includes(q)) return false;
      if (filters.selectedGenre !== "all" && !m.genres.includes(filters.selectedGenre)) return false;
      if (
        filters.selectedTheater !== "all" &&
        !m.showtimes.some((s) => s.theater.id === filters.selectedTheater)
      ) return false;
      if (
        filters.selectedDate !== "all" &&
        !m.showtimes.some((s) => s.dayOffset === filters.selectedDate)
      ) return false;
      if (filters.selectedLang !== "all") {
        const hasLang = m.showtimes.some(
          (s) =>
            s.language === filters.selectedLang &&
            (filters.selectedTheater === "all" || s.theater.id === filters.selectedTheater) &&
            (filters.selectedDate === "all" || s.dayOffset === filters.selectedDate)
        );
        if (!hasLang) return false;
      }
      return true;
    });
  }, [movies, filters]);

  const activeFilterCount = [
    filters.selectedLang !== "all",
    filters.selectedGenre !== "all",
    filters.selectedTheater !== "all",
  ].filter(Boolean).length;

  const rowFilters = {
    selectedDate: filters.selectedDate,
    selectedLang: filters.selectedLang,
    selectedTheater: filters.selectedTheater,
  };

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

      <Header
        searchQuery={filters.searchQuery}
        onSearch={(q) => setFilter("searchQuery", q)}
        filmCount={filteredMovies.length}
        filterPanelOpen={filters.filterPanelOpen}
        onToggleFilter={toggleFilterPanel}
        activeFilterCount={activeFilterCount}
      />

      {!loading && !error && (
        <DateBar
          selectedDate={filters.selectedDate}
          onSelect={(d) =>
            setFilters((f) => ({ ...f, selectedDate: d }))
          }
        />
      )}

      <FilterPanel
        open={filters.filterPanelOpen}
        onClose={() => setFilters((f) => ({ ...f, filterPanelOpen: false }))}
        filters={filters}
        onFilter={setFilter}
        genres={genres}
        theaters={theaters}
      />

      <div className="layout">
        <Sidebar
          filters={filters}
          onFilter={setFilter}
          genres={genres}
          theaters={theaters}
          movies={movies}
        />
        <main id="main-content" aria-labelledby="page-title" aria-busy={loading}>
          <h1 className="sr-only" id="page-title">Barcelona English-language cinema listings</h1>
          <MovieList
            movies={filteredMovies}
            allMoviesEmpty={movies.length === 0}
            loading={loading}
            error={error}
            onRetry={load}
            generatedAt={generatedAt}
            stale={stale}
            filters={rowFilters}
          />
        </main>
      </div>
    </>
  );
}
