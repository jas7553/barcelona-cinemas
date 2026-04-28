import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DayPicker from "../components/DayPicker";
import FilmCard from "../components/FilmCard";
import CinemaGroup from "../components/CinemaGroup";
import { MoonIcon, SunIcon, SearchIcon } from "../components/Icons";
import { useTheme } from "../context/ThemeContext";
import { generateDays, formatDataAge, buildCinemaGroups, normalizeForSearch } from "../utils";
import type { TransformedMovie } from "../types";

interface Props {
  movies: TransformedMovie[];
  loading: boolean;
  error: string | null;
  generatedAt: string | null;
  coords: { lat: number; lng: number } | null;
  locationResolving: boolean;
  onRetry: () => void;
}

export default function MainList({
  movies,
  loading,
  error,
  generatedAt,
  coords,
  locationResolving,
  onRetry,
}: Props) {
  const { dark, toggle: toggleDark } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const rawDay = searchParams.get("day");
  const selectedDay: number | null = rawDay !== null && !isNaN(Number(rawDay)) ? Number(rawDay) : null;
  const view: "film" | "cinema" = searchParams.get("view") === "cinema" ? "cinema" : "film";

  const setSelectedDay = (day: number | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (day == null) next.delete("day");
      else next.set("day", String(day));
      return next;
    }, { replace: true });
  };

  const days = generateDays();

  const dayMovies = useMemo(
    () =>
      selectedDay == null
        ? movies
        : movies.filter((m) => m.showtimes.some((s) => s.dayOffset === selectedDay)),
    [movies, selectedDay],
  );

  const activeDays = useMemo(
    () => new Set(movies.flatMap((m) => m.showtimes.map((s) => s.dayOffset))),
    [movies],
  );

  const cinemaGroups = useMemo(
    () => (view === "cinema" ? buildCinemaGroups(movies, selectedDay, coords) : []),
    [movies, selectedDay, coords, view],
  );

  const searchResults = useMemo(() => {
    const q = normalizeForSearch(searchQuery);
    if (!q) return movies;
    return movies.filter(
      (m) =>
        normalizeForSearch(m.title).includes(q) ||
        m.genres.some((g) => normalizeForSearch(g).includes(q)),
    );
  }, [movies, searchQuery]);

  const handleSetView = (v: "film" | "cinema") => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v === "cinema") {
        next.set("view", "cinema");
      } else {
        next.delete("view");
      }
      return next;
    }, { replace: true });
  };

  const openSearch = () => {
    setSearching(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const closeSearch = () => {
    setSearching(false);
    setSearchQuery("");
  };

  const dataAge = generatedAt ? formatDataAge(generatedAt) : null;
  const dayLabel = selectedDay == null ? "this week" : (days.find((d) => d.offset === selectedDay)?.fullLabel ?? "");

  const listCount = view === "film" ? dayMovies.length : cinemaGroups.length;
  const listNoun = view === "film"
    ? `film${listCount !== 1 ? "s" : ""}`
    : `cinema${listCount !== 1 ? "s" : ""}`;
  const showingLabel = selectedDay == null
    ? "showing this week"
    : (dayLabel === "tonight" || dayLabel === "today")
      ? `showing ${dayLabel}`
      : `showing on ${dayLabel}`;

  return (
    <>
      <div className="main-header">
        {searching ? (
          <>
            <div className="search-row">
              <div className="search-input-wrap">
                <SearchIcon size={16} color="var(--text-mute)" />
                <input
                  ref={searchInputRef}
                  className="search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Film title, genre…"
                  aria-label="Search films"
                />
                {searchQuery.length > 0 && (
                  <button
                    className="search-clear"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button className="search-cancel" onClick={closeSearch}>
                Cancel
              </button>
            </div>
            <div className="search-hint" aria-live="polite">
              {searchQuery.trim().length === 0
                ? "All films in English this week"
                : searchResults.length === 0
                  ? "No results"
                  : `${searchResults.length} film${searchResults.length !== 1 ? "s" : ""} found`}
            </div>
            <div className="search-divider" />
          </>
        ) : (
          <>
            <div className="header-top">
              <h1 className="app-title">
                <span className="app-title__line">Barcelona</span>
                <span className="app-title__line app-title__line--2">This Week</span>
              </h1>
              <div className="header-actions">
                <button className="icon-btn" onClick={toggleDark} aria-label="Toggle dark mode">
                  {dark ? <SunIcon /> : <MoonIcon />}
                </button>
                <button className="icon-btn" onClick={openSearch} aria-label="Search films">
                  <SearchIcon />
                </button>
              </div>
            </div>

            <DayPicker selectedDay={selectedDay} onSelect={setSelectedDay} activeDays={activeDays} />

            <div className="view-tabs" role="tablist">
              {(["film", "cinema"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  className={`view-tab${view === v ? " view-tab--active" : ""}`}
                  onClick={() => handleSetView(v)}
                >
                  {v === "film" ? "By Film" : "By Cinema"}
                </button>
              ))}
            </div>

            <div className="result-count" aria-live="polite">
              {loading ? (
                "Loading…"
              ) : error ? (
                "Could not load listings."
              ) : (
                <>
                  {listCount} {listNoun} {showingLabel}
                  {dataAge && <span className="result-count-age"> · updated {dataAge}</span>}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {searching ? (
        searchResults.length > 0 ? (
          <div className="film-list">
            {searchResults.map((m) => (
              <FilmCard key={m.id} movie={m} />
            ))}
          </div>
        ) : searchQuery.trim().length > 0 ? (
          <div className="empty-state">
            <div className="empty-state__emoji">🎞</div>
            <div className="empty-state__heading">Nothing showing</div>
            <div className="empty-state__body">
              No English-language screenings match <em>"{searchQuery}"</em> this week.
            </div>
          </div>
        ) : null
      ) : loading ? (
        <div className="loading-pulse" role="status" aria-label="Loading films">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="loading-card" />
          ))}
        </div>
      ) : error ? (
        <div className="empty-state">
          <div className="empty-state__overline">Error</div>
          <div className="empty-state__heading">Could not load listings</div>
          <div className="empty-state__body">Check your connection and try again.</div>
          <button className="empty-state__btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : view === "film" ? (
        dayMovies.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__overline">No screenings</div>
            <div className="empty-state__heading">
              Nothing showing<br />on {dayLabel}
            </div>
            <div className="empty-state__body">
              Try another day — most films run Wed through Sun.
            </div>
            <button className="empty-state__btn" onClick={() => setSelectedDay(null)}>
              Show all days
            </button>
          </div>
        ) : (
          <div className="film-list">
            {dayMovies.map((m) => (
              <FilmCard key={m.id} movie={m} dayOffset={selectedDay ?? undefined} />
            ))}
          </div>
        )
      ) : locationResolving ? (
        <div className="loading-pulse loading-pulse--cinema" role="status" aria-label="Loading cinemas">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="loading-card" />
          ))}
        </div>
      ) : cinemaGroups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__overline">No screenings</div>
          <div className="empty-state__heading">
            {selectedDay == null ? "No cinemas found" : <>No cinemas showing<br />on {dayLabel}</>}
          </div>
          <div className="empty-state__body">
            {selectedDay == null ? "No screenings found." : "Try another day."}
          </div>
          {selectedDay != null && (
            <button className="empty-state__btn" onClick={() => setSelectedDay(null)}>
              Show all days
            </button>
          )}
        </div>
      ) : (
        <div className="film-list">
          {cinemaGroups.map((g) => (
            <CinemaGroup key={g.theaterId} group={g} />
          ))}
        </div>
      )}
    </>
  );
}
