import { useEffect, useMemo, useRef, useState } from "react";
import BackdropPlaceholder from "../components/BackdropPlaceholder";
import PosterPlaceholder from "../components/PosterPlaceholder";
import DayPicker from "../components/DayPicker";
import CinemaSheet from "../components/CinemaSheet";
import SiteFooter from "../components/Footer";
import { BackIcon, ChevronRightIcon } from "../components/Icons";
import { ThemeProvider } from "../context/ThemeContext";
import { useNow, useUrlParams } from "../hooks/useClient";
import { useLocationPin } from "../hooks/useLocationPin";
import {
  transformResponse,
  formatDistKm,
  formatMovieMeta,
  formatLanguage,
  generateDays,
  buildCinemaRows,
  haversineKm,
  buildIcs,
  icsHref,
} from "../utils";
import type { Listings, TransformedMovie, SheetVenueData } from "../types";

export interface FilmPageData {
  /** Instant the page was pre-rendered (SSG); seeds the hydration clock. */
  renderedAt: string;
  /** Listings narrowed to this one film (movies: [film], theaters: used). */
  listings: Listings;
  filmId: string;
}

/**
 * Document root for `/film/<id>`. The detail data is embedded (no fetch), so
 * first paint shows real content — the Safari "no white flash on forward nav"
 * guarantee. Back is a real browser navigation (bfcache restores the list).
 */
export default function FilmPage({ data }: { data: FilmPageData }) {
  const now = useNow(data.renderedAt);
  const movie = useMemo(() => {
    const movies = transformResponse(data.listings, now);
    return movies.find((m) => m.id === data.filmId) ?? movies[0] ?? null;
  }, [data.listings, data.filmId, now]);

  const { coords, active, toggle } = useLocationPin();

  // Distance labels are nice-to-have: re-use geolocation only if the user has
  // already granted permission — never raise the system prompt uninvited.
  const geoRequested = useRef(false);
  useEffect(() => {
    if (active || geoRequested.current) return;
    geoRequested.current = true;
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        if (status.state === "granted") toggle();
      })
      .catch(() => {});
  }, [active, toggle]);

  return (
    <ThemeProvider>
      <div className="app-wrapper">
        <div className="app-shell">
          <main className="screen">
            {movie ? (
              <FilmView movie={movie} coords={coords} now={now} />
            ) : (
              <div className="detail-screen">
                <div className="empty-state empty-state--center">
                  <div className="empty-state__overline">Not found</div>
                  <div className="empty-state__heading">This film isn't showing</div>
                  <div className="empty-state__body">
                    It may have finished its run, or the link is out of date.
                  </div>
                  <a className="empty-state__btn" href="/">
                    See what's on
                  </a>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}

interface FilmViewProps {
  movie: TransformedMovie;
  coords: { lat: number; lng: number } | null;
  now: Date;
}

function FilmView({ movie, coords, now }: FilmViewProps) {
  const { params: searchParams, setParams } = useUrlParams();
  // The day filter lives in the URL (?day=): the list's filter carries over on
  // entry, and a changed day survives refresh/share. Replace-state keeps the
  // list's own history entry (and its params) untouched. Only honored if this
  // film actually plays that day.
  const rawDay = searchParams.get("day");
  const parsedDay = rawDay !== null && !isNaN(Number(rawDay)) ? Number(rawDay) : null;
  const selectedDay =
    parsedDay != null && movie.showtimes.some((s) => s.dayOffset === parsedDay)
      ? parsedDay
      : null;
  const setSelectedDay = (day: number | null) => {
    setParams((next) => {
      if (day == null) next.delete("day");
      else next.set("day", String(day));
    });
  };
  const [selectedPillKey, setSelectedPillKey] = useState<string | null>(null);
  const [scrollY, setScrollY] = useState(0);
  const [backHidden, setBackHidden] = useState(false);
  const [sheetVenue, setSheetVenue] = useState<SheetVenueData | null>(null);
  // Snapshot at mount — prevents jarring reorder when geolocation resolves after render
  const [sortCoords] = useState(coords);
  const rafRef = useRef<number | null>(null);
  const lastScrollTop = useRef(0);

  // Prefer real browser back so the list restores its scroll + filters via
  // bfcache; fall back to the home document on a cold deep-link entry.
  const onBack = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign("/");
  };

  const backdropOpacity = Math.max(0, 1 - scrollY / 130);

  const activeDays = useMemo(
    () => new Set(movie.showtimes.map((s) => s.dayOffset)),
    [movie.showtimes],
  );

  const days = useMemo(() => generateDays(now), [now]);

  const cinemaRows = useMemo(
    () => buildCinemaRows(movie, selectedDay, sortCoords, now),
    [movie, selectedDay, sortCoords, now],
  );

  const showtimeCount = movie.showtimes.filter(
    (s) => selectedDay == null || s.dayOffset === selectedDay,
  ).length;

  const meta = formatMovieMeta(movie, true);
  const originalLanguage = formatLanguage(movie.original_lang);

  const letterboxdHref = movie.links.imdb_id
    ? `https://letterboxd.com/imdb/${movie.links.imdb_id}/`
    : `https://letterboxd.com/search/${encodeURIComponent(`${movie.title}${movie.year != null ? ` ${movie.year}` : ""}`)}`;
  const rtHref = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(movie.title)}`;
  const metacriticHref = `https://www.metacritic.com/search/${encodeURIComponent(movie.title)}/`;

  // Detail scrolls the document body (so iOS Safari pull-to-refresh works);
  // track window scroll for the backdrop fade + Back-pill auto-hide. No manual
  // scroll reset: this is its own document, loaded at the top on forward nav and
  // restored natively (bfcache) on back.
  useEffect(() => {
    if (selectedPillKey == null) return;
    const handler = () => setSelectedPillKey(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [selectedPillKey]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedPillKey(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        const y = window.scrollY;
        setScrollY(y);
        // Tuck the floating Back pill away while scrolling down so it doesn't
        // sit on top of the showtime grid; bring it back on any upward scroll.
        const last = lastScrollTop.current;
        lastScrollTop.current = y;
        if (y > last && y > 160) setBackHidden(true);
        else if (y < last || y <= 160) setBackHidden(false);
        rafRef.current = null;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="detail-screen">
      <CinemaSheet venue={sheetVenue} onClose={() => setSheetVenue(null)} />

      {/* Backdrop */}
      <div className="detail-backdrop" style={{ opacity: backdropOpacity }}>
        {movie.backdrop_url ? (
          <img
            src={movie.backdrop_url}
            alt=""
            className="detail-backdrop-img"
            width={430}
            height={200}
            fetchPriority="high"
            decoding="async"
            loading="lazy"
          />
        ) : (
          <BackdropPlaceholder w={430} h={200} id={movie.id} />
        )}
        <div
          className="detail-backdrop-gradient"
          style={{ background: `linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, var(--bg) 100%)` }}
        />
      </div>

      {/* Back button */}
      <button
        className={`detail-back-btn${backHidden ? " detail-back-btn--hidden" : ""}`}
        onClick={onBack}
        aria-label="Back"
      >
        <BackIcon />
        <span>Back</span>
      </button>

      {/* Scrollable content */}
      <div className="detail-content">
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
                  loading="lazy"
                  decoding="async"
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
            {movie.tagline && <p className="tagline">{movie.tagline}</p>}
            {movie.synopsis ? (
              <p className="synopsis-text">{movie.synopsis}</p>
            ) : (
              <p className="synopsis-empty">No synopsis available from TMDb.</p>
            )}
            {(movie.director || (movie.cast && movie.cast.length > 0) || originalLanguage) && (
              <dl className="credits">
                {movie.director && (
                  <div className="credits-row">
                    <dt className="credits-label">Director</dt>
                    <dd className="credits-value">{movie.director}</dd>
                  </div>
                )}
                {movie.cast && movie.cast.length > 0 && (
                  <div className="credits-row">
                    <dt className="credits-label">Cast</dt>
                    <dd className="credits-value">{movie.cast.join(", ")}</dd>
                  </div>
                )}
                {originalLanguage && (
                  <div className="credits-row">
                    <dt className="credits-label">Language</dt>
                    <dd className="credits-value">{originalLanguage}</dd>
                  </div>
                )}
              </dl>
            )}
            <div className="external-links">
              {movie.links.imdb && (
                <FaviconLink icon="/imdb-favicon.png" label="IMDb" href={movie.links.imdb} />
              )}
              <FaviconLink icon="/letterboxd-favicon.ico" label="Letterboxd" href={letterboxdHref} />
              <FaviconLink icon="/rt-favicon.ico" label="Rotten Tomatoes" href={rtHref} />
              <FaviconLink icon="/metacritic-favicon.ico" label="Metacritic" href={metacriticHref} />
            </div>
          </div>

          {/* Showtimes */}
          <div className="detail-showtimes">
            <div className="showtimes-heading">Showtimes</div>

            <DayPicker selectedDay={selectedDay} onSelect={setSelectedDay} activeDays={activeDays} days={days} />

            {cinemaRows.length > 0 && (
              <div className="cinema-count">
                {`${showtimeCount} showtime${showtimeCount !== 1 ? "s" : ""} · ${cinemaRows.length} cinema${cinemaRows.length !== 1 ? "s" : ""}`}
              </div>
            )}

            {selectedDay != null && cinemaRows.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-sub)", padding: "4px 0 8px" }}>
                No screenings on this day.
              </div>
            ) : (
              cinemaRows.map(({ theater, dayGroups, distKm }) => {
                // Sort order stays frozen to mount-time coords, but distance
                // labels use live coords — geolocation usually resolves after
                // first render, and without this the labels never appear.
                const liveKm =
                  coords && theater.lat != null && theater.lng != null
                    ? haversineKm(coords.lat, coords.lng, theater.lat, theater.lng)
                    : distKm;
                const dl = formatDistKm(liveKm);

                // Change 3: bookability signal in cinema header.
                const isBookable = dayGroups.some((g) => g.times.some((t) => t.bookingUrl));

                // Change 1: badge hoisting — compute uniform badge per day-group.
                const groupBadgeResults = dayGroups.map((g) => {
                  const set = new Set(g.times.map((t) => t.badge));
                  const isUniform = set.size === 1;
                  return { isUniform, value: isUniform ? [...set][0] : null };
                });
                // Promote to cinema header when ALL day-groups share the same non-null badge.
                const cinemaHeaderBadge: string | null =
                  groupBadgeResults.length > 0 &&
                  groupBadgeResults.every(
                    (r) => r.isUniform && r.value !== null && r.value === groupBadgeResults[0].value,
                  )
                    ? groupBadgeResults[0].value
                    : null;

                return (
                  <div key={theater.id} className="cinema-row">
                    <button
                      className="cinema-row__header"
                      onClick={() =>
                        setSheetVenue({
                          name: theater.name,
                          address: theater.address || undefined,
                          neighborhood: theater.neighborhood || undefined,
                          distLabel: dl ?? undefined,
                          mapsUrl: theater.maps_url || undefined,
                          websiteUrl: theater.website_url || undefined,
                          lat: theater.lat,
                          lng: theater.lng,
                        })
                      }
                    >
                      <span className="cinema-row__name">{theater.name}</span>
                      <div className="cinema-row__right">
                        {isBookable && <span className="cinema-row__book-badge">Book online</span>}
                        {cinemaHeaderBadge && (
                          <span className="cinema-row__header-badge">{cinemaHeaderBadge}</span>
                        )}
                        {dl && <span className="cinema-row__dist">{dl}</span>}
                        <ChevronRightIcon />
                      </div>
                    </button>
                    <div className={`cinema-row__times${selectedDay == null ? " cinema-row__times--grouped" : ""}`}>
                      {dayGroups.map((group, gi) => {
                        const { isUniform, value: groupHoistedBadge } = groupBadgeResults[gi];
                        const showDayBadge = !cinemaHeaderBadge && isUniform && groupHoistedBadge !== null;
                        const pills = group.times.map(({ key, t, date, bookingUrl, badge, formatBadge }) => (
                          <TimePill
                            key={key}
                            pillKey={key}
                            selectedKey={selectedPillKey}
                            onSelect={setSelectedPillKey}
                            time={t}
                            date={date}
                            bookingUrl={bookingUrl}
                            badge={isUniform ? null : badge}
                            formatBadge={formatBadge}
                            film={movie.title}
                            cinema={theater.name}
                            address={theater.address}
                            runtimeMinutes={movie.runtime_minutes}
                            now={now}
                          />
                        ));
                        return group.label == null ? (
                          pills
                        ) : (
                          <div key={group.offset} className="cinema-row__day-group">
                            <span className="cinema-row__day-label">{group.label}</span>
                            {showDayBadge && (
                              <span className="cinema-row__day-badge">{groupHoistedBadge}</span>
                            )}
                            <div className="cinema-row__day-pills">{pills}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}

            <div className="detail-bottom-spacer" />
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

function TimePill({
  time,
  date,
  bookingUrl,
  badge,
  formatBadge,
  film,
  cinema,
  address,
  runtimeMinutes,
  now,
  pillKey,
  selectedKey,
  onSelect,
}: {
  time: string;
  date: string;
  bookingUrl?: string;
  badge: string | null;
  formatBadge: string | null;
  film: string;
  cinema: string;
  address: string;
  runtimeMinutes: number | null;
  now: Date;
  pillKey: string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const isSelected = pillKey === selectedKey;
  const ics = buildIcs(
    {
      title: film,
      location: [cinema, address].filter(Boolean).join(", "),
      date,
      time,
      runtimeMinutes,
    },
    now,
  );
  const calName = `${film.replace(/\s+/g, "-").toLowerCase()}-${date}-${time.replace(":", "")}.ics`;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(isSelected ? null : pillKey);
  };

  return (
    <div className="time-pill-group">
      <div className="time-pill-group__row">
        {bookingUrl ? (
          <>
            <a
              href={bookingUrl}
              target="_blank"
              rel="noreferrer"
              className={`time-pill time-pill--lg time-pill--link${isSelected ? " time-pill--selected" : ""}`}
              aria-label={`Buy tickets for ${film} at ${cinema}, ${time}`}
            >
              <time>{time}</time>
              <span className="time-pill__ticket" aria-hidden="true">🎟</span>
            </a>
            <button
              className="time-pill__chevron"
              onClick={handleToggle}
              aria-expanded={isSelected}
              aria-label="Show showtime options"
            >
              ▾
            </button>
          </>
        ) : (
          <button
            className={`time-pill time-pill--lg${isSelected ? " time-pill--selected" : ""}`}
            onClick={handleToggle}
            aria-expanded={isSelected}
            aria-label={`${time} at ${cinema}`}
          >
            <time>{time}</time>
          </button>
        )}
        {badge && <span className="subtitle-badge">{badge}</span>}
        {formatBadge && <span className="format-badge">{formatBadge}</span>}
      </div>
      {isSelected && (
        <div className="time-pill__actions" role="group" aria-label="Showtime options">
          {bookingUrl && (
            <a
              href={bookingUrl}
              target="_blank"
              rel="noreferrer"
              className="time-pill__action-book"
              onClick={(e) => e.stopPropagation()}
            >
              Book tickets ↗
            </a>
          )}
          <a
            href={icsHref(ics)}
            download={calName}
            className="time-pill__action-cal"
            onClick={(e) => e.stopPropagation()}
          >
            Add to calendar
          </a>
        </div>
      )}
    </div>
  );
}

function FaviconLink({ icon, label, href }: { icon: string; label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="ext-link">
      <img src={icon} width={14} height={14} alt="" style={{ borderRadius: 2 }} />
      {label}
    </a>
  );
}
