import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SharedProps } from "../App";
import type { AppState } from "../types";
import { normalizeForSearch } from "../utils";
import DateBar from "../components/DateBar";
import FilterPanel from "../components/FilterPanel";
import Footer from "../components/Footer";
import Header from "../components/Header";
import MovieList from "../components/MovieList";
import Sidebar from "../components/Sidebar";
import TheaterFilterSheet from "../components/TheaterFilterSheet";
import type { SortBy } from "../components/SortControl";

const INITIAL_FILTERS: AppState = {
  selectedDate: "all",
  selectedLang: "all",
  selectedGenre: "all",
  selectedTheater: "all",
  searchQuery: "",
  filterPanelOpen: false,
};

export default function ShowtimesView({
  movies,
  theaters,
  genres,
  generatedAt,
  stale,
  loading,
  error,
  onRetry,
}: SharedProps) {
  const [filters, setFilters] = useState<AppState>(INITIAL_FILTERS);
  const [sortBy, setSortBy] = useState<SortBy>("rating");
  const [theaterSheetOpen, setTheaterSheetOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const targetFilm = searchParams.get("film");

  useEffect(() => {
    if (!loading && targetFilm) {
      const el = document.getElementById(`film-${targetFilm}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [loading, targetFilm]);

  const setFilter = useCallback((key: keyof AppState, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);

  const toggleFilterPanel = useCallback(() => {
    setFilters((f) => ({ ...f, filterPanelOpen: !f.filterPanelOpen }));
  }, []);

  const filteredMovies = useMemo(() => {
    const q = normalizeForSearch(filters.searchQuery);
    const filtered = movies.filter((m) => {
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

    const sorted = [...filtered];
    if (sortBy === "rating") {
      sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    } else if (sortBy === "title") {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "soonest") {
      const earliest = (m: typeof movies[0]) =>
        m.showtimes.map((s) => s.date + "T" + s.time).sort()[0] ?? "9999";
      sorted.sort((a, b) => earliest(a).localeCompare(earliest(b)));
    } else if (sortBy === "screenings") {
      sorted.sort((a, b) => b.showtimes.length - a.showtimes.length);
    }
    return sorted;
  }, [movies, filters, sortBy]);

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
        activeView="showtimes"
      />

      {!loading && !error && (
        <DateBar
          selectedDate={filters.selectedDate}
          onSelect={(d) => setFilters((f) => ({ ...f, selectedDate: d }))}
        />
      )}

      <FilterPanel
        open={filters.filterPanelOpen}
        onClose={() => setFilters((f) => ({ ...f, filterPanelOpen: false }))}
        filters={filters}
        onFilter={setFilter}
        genres={genres}
        theaters={theaters}
        onOpenTheaterSheet={() => setTheaterSheetOpen(true)}
      />

      <TheaterFilterSheet
        open={theaterSheetOpen}
        onClose={() => setTheaterSheetOpen(false)}
        theaters={theaters}
        selectedTheater={filters.selectedTheater}
        onSelect={(id) => setFilter("selectedTheater", id)}
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
            onRetry={onRetry}
            generatedAt={generatedAt}
            stale={stale}
            filters={rowFilters}
            sortBy={sortBy}
            onSortChange={setSortBy}
            expandedFilmId={targetFilm ?? undefined}
          />
        </main>
      </div>

      <Footer />
    </>
  );
}
