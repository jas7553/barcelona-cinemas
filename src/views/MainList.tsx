import { useMemo, useState } from "react";
import DayPicker from "../components/DayPicker";
import FilmCard from "../components/FilmCard";
import CinemaGroup from "../components/CinemaGroup";
import BottomNav from "../components/BottomNav";
import { MoonIcon, SunIcon, SearchIcon } from "../components/Icons";
import { useTheme } from "../context/ThemeContext";
import { generateDays, formatDataAge, buildCinemaGroups } from "../utils";
import type { TransformedMovie } from "../types";

interface Props {
  movies: TransformedMovie[];
  loading: boolean;
  error: string | null;
  generatedAt: string | null;
  coords: { lat: number; lng: number } | null;
  onSearch: () => void;
  onRetry: () => void;
}

export default function MainList({
  movies,
  loading,
  error,
  generatedAt,
  coords,
  onSearch,
  onRetry,
}: Props) {
  const { dark, toggle: toggleDark } = useTheme();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [view, setView] = useState<"film" | "cinema">("film");

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
    () => (view === "cinema" ? buildCinemaGroups(movies, selectedDay ?? 0, coords) : []),
    [movies, selectedDay, coords, view],
  );

  const handleSetView = (v: "film" | "cinema") => {
    if (v === "cinema" && selectedDay == null) setSelectedDay(0);
    setView(v);
  };

  const dataAge = generatedAt ? formatDataAge(generatedAt) : null;
  const dayLabel = selectedDay == null ? "this week" : (days.find((d) => d.offset === selectedDay)?.fullLabel ?? "");

  const listCount = view === "film" ? dayMovies.length : cinemaGroups.length;
  const listNoun = view === "film"
    ? `film${listCount !== 1 ? "s" : ""}`
    : `cinema${listCount !== 1 ? "s" : ""}`;
  const showingLabel = selectedDay == null ? "showing this week" : `showing on ${dayLabel}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <div className="film-list-scroll">
        <div className="main-header">
          <div className="header-top">
            <h1 className="app-title">
              Barcelona<br />This Week
            </h1>
            <div className="header-actions">
              <button className="icon-btn" onClick={toggleDark} aria-label="Toggle dark mode">
                {dark ? <SunIcon /> : <MoonIcon />}
              </button>
              <button className="icon-btn" onClick={onSearch} aria-label="Search films">
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
        </div>

        {loading ? (
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
        ) : cinemaGroups.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__overline">No screenings</div>
            <div className="empty-state__heading">
              No cinemas showing<br />on {dayLabel}
            </div>
            <div className="empty-state__body">Try another day.</div>
            <button className="empty-state__btn" onClick={() => setSelectedDay(null)}>
              Show all days
            </button>
          </div>
        ) : (
          <div className="film-list">
            {cinemaGroups.map((g) => (
              <CinemaGroup key={g.theaterId} group={g} />
            ))}
          </div>
        )}
      </div>

      <BottomNav active="list" />
    </div>
  );
}
