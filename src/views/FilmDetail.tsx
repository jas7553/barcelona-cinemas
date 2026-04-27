import { useCallback, useMemo, useRef, useState } from "react";
import BackdropPlaceholder from "../components/BackdropPlaceholder";
import PosterPlaceholder from "../components/PosterPlaceholder";
import DayPicker from "../components/DayPicker";
import CinemaSheet from "../components/CinemaSheet";
import type { SheetVenueData } from "../components/CinemaSheet";
import BottomNav from "../components/BottomNav";
import { haversineKm, formatDistKm, generateDays } from "../utils";
import type { TransformedMovie } from "../types";

interface Props {
  movie: TransformedMovie;
  coords: { lat: number; lng: number } | null;
  onBack: () => void;
}

function BackIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-mute)" strokeWidth="2.5" strokeLinecap="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function FaviconLink({ domain, label, href }: { domain: string; label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="ext-link">
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
        width={14}
        height={14}
        alt=""
        style={{ borderRadius: 2 }}
      />
      {label}
    </a>
  );
}

export default function FilmDetail({ movie, coords, onBack }: Props) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [scrollY, setScrollY] = useState(0);
  const [sheetVenue, setSheetVenue] = useState<SheetVenueData | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const backdropOpacity = Math.max(0, 1 - scrollY / 130);

  const activeDays = useMemo(
    () => new Set(movie.showtimes.map((s) => s.dayOffset)),
    [movie.showtimes],
  );

  type DayGroup = { label: string | null; offset: number; times: { key: string; t: string }[] };

  const cinemaRows = useMemo(() => {
    const showtimes =
      selectedDay != null
        ? movie.showtimes.filter((s) => s.dayOffset === selectedDay)
        : movie.showtimes;

    const dayLabelMap = new Map(generateDays().map((d) => [d.offset, d.label]));

    const byTheater = new Map<string, { theater: (typeof showtimes)[0]["theater"]; groups: Map<number, DayGroup> }>();

    for (const s of showtimes) {
      const entry = byTheater.get(s.theater.id) ?? { theater: s.theater, groups: new Map<number, DayGroup>() };
      const key = `${s.dayOffset}-${s.time}`;
      if (selectedDay != null) {
        const group = entry.groups.get(0) ?? { label: null, offset: 0, times: [] };
        if (!group.times.some((x) => x.key === key)) group.times.push({ key, t: s.time });
        entry.groups.set(0, group);
      } else {
        const label =
          dayLabelMap.get(s.dayOffset) ??
          new Date(`${s.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
        const group = entry.groups.get(s.dayOffset) ?? { label, offset: s.dayOffset, times: [] };
        if (!group.times.some((x) => x.key === key)) group.times.push({ key, t: s.time });
        entry.groups.set(s.dayOffset, group);
      }
      byTheater.set(s.theater.id, entry);
    }

    return [...byTheater.values()]
      .map(({ theater, groups }) => {
        const distKm =
          coords && theater.lat != null && theater.lng != null
            ? haversineKm(coords.lat, coords.lng, theater.lat, theater.lng)
            : undefined;
        const dayGroups: DayGroup[] = [...groups.values()]
          .sort((a, b) => a.offset - b.offset)
          .map((g) => ({ ...g, times: [...g.times].sort((a, b) => a.t.localeCompare(b.t)) }));
        return { theater, dayGroups, distKm };
      })
      .sort((a, b) => {
        if (a.distKm !== undefined && b.distKm !== undefined) return a.distKm - b.distKm;
        return a.theater.name.localeCompare(b.theater.name);
      });
  }, [movie.showtimes, selectedDay, coords]);

  const genre = movie.genres.slice(0, 2).join(" · ");
  const meta = [genre, movie.year?.toString(), movie.runtimeLabel].filter(Boolean).join(" · ");

  const letterboxdHref = movie.links.imdb_id
    ? `https://letterboxd.com/imdb/${movie.links.imdb_id}/`
    : `https://letterboxd.com/search/${encodeURIComponent(`${movie.title}${movie.year != null ? ` ${movie.year}` : ""}`)}`;
  const rtHref = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(movie.title)}`;
  const metacriticHref = `https://www.metacritic.com/search/${encodeURIComponent(movie.title)}/`;

  const onScroll = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      setScrollY(contentRef.current?.scrollTop ?? 0);
      rafRef.current = null;
    });
  }, []);

  return (
    <div className="detail-screen">
      <CinemaSheet venue={sheetVenue} onClose={() => setSheetVenue(null)} />

      {/* Backdrop */}
      <div className="detail-backdrop" style={{ opacity: backdropOpacity }}>
        {movie.backdrop_url ? (
          <img src={movie.backdrop_url} alt="" className="detail-backdrop-img" />
        ) : (
          <BackdropPlaceholder w={430} h={200} id={movie.id} />
        )}
        <div
          className="detail-backdrop-gradient"
          style={{ background: `linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, var(--bg) 100%)` }}
        />
      </div>

      {/* Back button */}
      <button className="detail-back-btn" onClick={onBack} aria-label="Back">
        <BackIcon />
        <span>Back</span>
      </button>

      {/* Scrollable content */}
      <div
        ref={contentRef}
        className="detail-content"
        onScroll={onScroll}
      >
        <div className="detail-spacer" />

        <div className="detail-body">
          {/* Poster + title row */}
          <div className="detail-poster-row">
            <div className="detail-poster">
              {movie.poster_url ? (
                <img
                  src={movie.poster_url}
                  alt={movie.title}
                  width={76}
                  height={112}
                  style={{ objectFit: "cover" }}
                />
              ) : (
                <PosterPlaceholder w={76} h={112} id={movie.id} />
              )}
            </div>
            <div className="detail-meta-col">
              <h1 className="detail-film-title">{movie.title}</h1>
              {meta && <div className="detail-film-meta">{meta}</div>}
              <div className="detail-badges">
                {movie.rating != null && (
                  <div className="rating-badge">★ {movie.rating.toFixed(1)}</div>
                )}
                {movie.trailer_url && (
                  <a
                    href={movie.trailer_url}
                    target="_blank"
                    rel="noreferrer"
                    className="trailer-btn"
                    aria-label={`Watch ${movie.title} trailer`}
                  >
                    ▶ Trailer
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Synopsis + external links */}
          <div className="synopsis-card">
            {movie.synopsis ? (
              <p className="synopsis-text">{movie.synopsis}</p>
            ) : (
              <p className="synopsis-empty">No synopsis available from TMDb.</p>
            )}
            <div className="external-links">
              {movie.links.imdb && (
                <FaviconLink domain="imdb.com" label="IMDb" href={movie.links.imdb} />
              )}
              <FaviconLink domain="letterboxd.com" label="Letterboxd" href={letterboxdHref} />
              <FaviconLink domain="rottentomatoes.com" label="Rotten Tomatoes" href={rtHref} />
              <FaviconLink domain="metacritic.com" label="Metacritic" href={metacriticHref} />
            </div>
          </div>

          {/* Showtimes */}
          <div className="detail-showtimes">
            <div className="showtimes-heading">Showtimes</div>

            <DayPicker selectedDay={selectedDay} onSelect={setSelectedDay} activeDays={activeDays} />

            {cinemaRows.length > 0 && (
              <div className="cinema-count">
                {cinemaRows.length} cinema{cinemaRows.length !== 1 ? "s" : ""} showing
              </div>
            )}

            {selectedDay != null && cinemaRows.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-sub)", padding: "4px 0 8px" }}>
                No screenings on this day.
              </div>
            ) : (
              cinemaRows.map(({ theater, dayGroups, distKm }) => {
                const dl = formatDistKm(distKm);
                return (
                  <div key={theater.id} className="cinema-row">
                    <button
                      className="cinema-row__header"
                      onClick={() =>
                        setSheetVenue({
                          name: theater.name,
                          neighborhood: theater.neighborhood || undefined,
                          distLabel: dl ?? undefined,
                          mapsUrl: theater.maps_url || undefined,
                        })
                      }
                    >
                      <span className="cinema-row__name">{theater.name}</span>
                      <div className="cinema-row__right">
                        {dl && <span className="cinema-row__dist">{dl}</span>}
                        <ChevronRightIcon />
                      </div>
                    </button>
                    <div className={selectedDay == null ? "cinema-row__times cinema-row__times--grouped" : "cinema-row__times"}>
                      {dayGroups.map((group) =>
                        group.label == null ? (
                          group.times.map(({ key, t }) => (
                            <time key={key} className="time-pill time-pill--lg">{t}</time>
                          ))
                        ) : (
                          <div key={group.offset} className="cinema-row__day-group">
                            <span className="cinema-row__day-label">{group.label}</span>
                            <div className="cinema-row__day-pills">
                              {group.times.map(({ key, t }) => (
                                <time key={key} className="time-pill time-pill--lg">{t}</time>
                              ))}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                );
              })
            )}

            <div className="detail-bottom-spacer" />
          </div>
        </div>
      </div>

      <BottomNav active="list" />
    </div>
  );
}
