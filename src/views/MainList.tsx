import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DayPicker from "../components/DayPicker";
import FilmCard from "../components/FilmCard";
import CinemaGroup from "../components/CinemaGroup";
import CinemaSheet from "../components/CinemaSheet";
import { MoonIcon, SunIcon, SearchIcon, PinIcon } from "../components/Icons";
import { useTheme } from "../context/ThemeContext";
import { generateDays, formatDataAge, buildCinemaGroups, normalizeForSearch } from "../utils";
import type { CinemaViewGroup, SheetVenueData, TransformedMovie } from "../types";

interface Props {
  movies: TransformedMovie[];
  loading: boolean;
  error: string | null;
  generatedAt: string | null;
  stale: boolean;
  coords: { lat: number; lng: number } | null;
  locationActive: boolean;
  locationError: boolean;
  locationResolving: boolean;
  onToggleLocation: () => void;
  onRetry: () => void;
}

export default function MainList({
  movies,
  loading,
  error,
  generatedAt,
  stale,
  coords,
  locationActive,
  locationError,
  locationResolving,
  onToggleLocation,
  onRetry,
}: Props) {
  const { dark, toggle: toggleDark } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  // Search lives in the URL (?q=) so returning from a film detail restores it
  const rawQuery = searchParams.get("q");
  const searching = rawQuery !== null;
  const searchQuery = rawQuery ?? "";
  // The input is driven by local state, not the URL: writing ?q= per keystroke
  // re-rendered the input from async router state, which could drop fast
  // keystrokes. The URL follows behind, debounced.
  const [searchInput, setSearchInput] = useState(searchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prevSearching = useRef(searching);
  // Projector warm-up plays once per session, not on every return to the list
  const [warmAnim] = useState(() => sessionStorage.getItem("btw-warmed") === null);
  const [sheetVenue, setSheetVenue] = useState<SheetVenueData | null>(null);

  const openCinemaSheet = (group: CinemaViewGroup, distLabel: string | null) => {
    const t = group.theater;
    setSheetVenue({
      name: t.name,
      address: t.address || undefined,
      neighborhood: t.neighborhood || undefined,
      distLabel: distLabel ?? undefined,
      mapsUrl: t.maps_url || undefined,
      websiteUrl: t.website_url || undefined,
      lat: t.lat,
      lng: t.lng,
    });
  };

  // Restore scroll when returning from a film detail; the list unmounts while
  // the detail screen is shown, so the browser can't do this for us. Save on
  // click capture (before a Link can navigate) — at unmount the list DOM is
  // already gone and scrollY has collapsed to 0.
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem("btw-list-scroll");
    if (saved) {
      sessionStorage.removeItem("btw-list-scroll");
      const target = Number(saved);
      window.scrollTo(0, target);
      // The first jump clamps if cards below the fold haven't laid out yet —
      // keep nudging for a few frames until the page is tall enough.
      let tries = 0;
      const settle = () => {
        if (Math.abs(window.scrollY - target) > 1 && tries++ < 20) {
          window.scrollTo(0, target);
          requestAnimationFrame(settle);
        }
      };
      requestAnimationFrame(settle);
    }
    const save = () => sessionStorage.setItem("btw-list-scroll", String(window.scrollY));
    document.addEventListener("click", save, true);
    return () => document.removeEventListener("click", save, true);
  }, []);

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
    const q = normalizeForSearch(searchInput);
    if (!q) return movies;
    return movies.filter(
      (m) =>
        normalizeForSearch(m.title).includes(q) ||
        m.genres.some((g) => normalizeForSearch(g).includes(q)),
    );
  }, [movies, searchInput]);

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

  const setSearchQuery = (value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("q", value);
      return next;
    }, { replace: true });
  };

  const openSearch = () => {
    setSearchInput("");
    setSearchQuery("");
  };

  const closeSearch = () => {
    setSearchInput("");
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("q");
      return next;
    }, { replace: true });
  };

  // Sync the typed query into the URL once typing pauses
  useEffect(() => {
    if (!searching || searchInput === searchQuery) return;
    const t = setTimeout(() => setSearchQuery(searchInput), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, searchInput, searchQuery]);

  // Focus the input when search opens via the button — but not when search
  // state is restored from the URL (back navigation), where a popping
  // keyboard would be jarring.
  useEffect(() => {
    if (searching && !prevSearching.current) searchInputRef.current?.focus();
    prevSearching.current = searching;
  }, [searching]);

  useEffect(() => {
    sessionStorage.setItem("btw-warmed", "1");
  }, []);

  const dataAge = generatedAt ? formatDataAge(generatedAt) : null;
  const dayLabel = selectedDay == null ? "this week" : (days.find((d) => d.offset === selectedDay)?.fullLabel ?? "");

  const listCount = view === "film" ? dayMovies.length : cinemaGroups.length;
  const listNoun = view === "film"
    ? `film${listCount !== 1 ? "s" : ""}`
    : `cinema${listCount !== 1 ? "s" : ""}`;
  // "21 films at 14 cinemas" tells the visitor the coverage at a glance
  const cinemaCount = useMemo(() => {
    if (view !== "film") return null;
    const ids = new Set(
      dayMovies.flatMap((m) =>
        m.showtimes
          .filter((s) => selectedDay == null || s.dayOffset === selectedDay)
          .map((s) => s.theater.id),
      ),
    );
    return ids.size;
  }, [view, dayMovies, selectedDay]);
  const atCinemas = cinemaCount != null && cinemaCount > 0
    ? ` at ${cinemaCount} cinema${cinemaCount !== 1 ? "s" : ""}`
    : "";
  const showingLabel = selectedDay == null
    ? "this week"
    : (dayLabel === "tonight" || dayLabel === "today")
      ? dayLabel
      : `on ${dayLabel}`;

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
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") closeSearch();
                  }}
                  enterKeyHint="done"
                  placeholder="Film title, genre…"
                  aria-label="Search films"
                />
                {searchInput.length > 0 && (
                  <button
                    className="search-clear"
                    onClick={() => {
                      setSearchInput("");
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
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
              {searchInput.trim().length === 0
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
              <h1 className={`app-title${warmAnim ? " app-title--animate" : ""}`}>
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

            <div className="view-tabs">
              {(["film", "cinema"] as const).map((v) => (
                <button
                  key={v}
                  aria-pressed={view === v}
                  className={`view-tab${view === v ? " view-tab--active" : ""}`}
                  onClick={() => handleSetView(v)}
                >
                  {v === "film" ? "By Film" : "By Cinema"}
                </button>
              ))}
            </div>

            <div className="result-row">
              <div className="result-count" aria-live="polite">
                {loading ? (
                  "Loading…"
                ) : error ? null : (
                  <>
                    {listCount} {listNoun}{atCinemas} {showingLabel}
                    {(dataAge || stale) && (
                      <span className={`result-count-age${stale ? " result-count-age--stale" : ""}`}>
                        {" "}· {dataAge ? `updated ${dataAge}` : "may be out of date"}
                      </span>
                    )}
                  </>
                )}
              </div>
              {view === "cinema" && (
                <button
                  className={`near-btn${locationActive ? " near-btn--active" : ""}`}
                  onClick={onToggleLocation}
                  aria-pressed={locationActive}
                  aria-label="Sort cinemas by distance"
                >
                  <PinIcon size={12} />
                  {locationError ? "No location" : locationResolving ? "Locating…" : "Near me"}
                </button>
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
        ) : searchInput.trim().length > 0 ? (
          <div className="empty-state">
            <div className="empty-state__heading">Nothing showing</div>
            <div className="empty-state__body">
              No English-language screenings match <em>"{searchInput}"</em> this week.
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
              Nothing showing<br />{showingLabel}
            </div>
            {selectedDay == null ? (
              <div className="empty-state__body">
                {dataAge
                  ? `Listings were last updated ${dataAge} and may be out of date. Check back soon.`
                  : "Check back soon — listings refresh every few hours."}
              </div>
            ) : (
              <>
                <div className="empty-state__body">
                  Try another day — most films run Wed through Sun.
                </div>
                <button className="empty-state__btn" onClick={() => setSelectedDay(null)}>
                  Show all days
                </button>
              </>
            )}
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
            {selectedDay == null ? "No cinemas found" : <>No cinemas showing<br />{showingLabel}</>}
          </div>
          <div className="empty-state__body">
            {selectedDay == null
              ? dataAge
                ? `Listings were last updated ${dataAge} and may be out of date. Check back soon.`
                : "Check back soon — listings refresh every few hours."
              : "Try another day."}
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
            <CinemaGroup key={g.theaterId} group={g} onCinemaTap={openCinemaSheet} />
          ))}
        </div>
      )}

      {!searching && !loading && !error && listCount > 0 && (
        <div className="list-footnote">
          All listings are original-version (VO) screenings — English audio
          unless the film itself isn't in English.
        </div>
      )}

      <CinemaSheet venue={sheetVenue} onClose={() => setSheetVenue(null)} />
    </>
  );
}
