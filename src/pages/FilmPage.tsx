import { useEffect, useMemo, useRef, useState } from "react";
import BackdropPlaceholder from "../components/BackdropPlaceholder";
import PosterPlaceholder from "../components/PosterPlaceholder";
import DayPicker from "../components/DayPicker";
import CinemaSheet from "../components/CinemaSheet";
import SiteFooter from "../components/Footer";
import DataAge, { dataAgeLabel } from "../components/DataAge";
import { BackIcon, ChevronDownIcon, ChevronRightIcon, MoonIcon, SunIcon } from "../components/Icons";
import { ThemeProvider, useTheme } from "../context/ThemeContext";
import { useNow, useUrlParams } from "../hooks/useClient";
import { useLocationPin } from "../hooks/useLocationPin";
import {
  transformResponse,
  formatDistKm,
  formatMovieMeta,
  formatLanguage,
  generateDays,
  dayHorizon,
  buildDaySections,
  buildIcs,
  icsHref,
  viewingLangLabel,
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
  // The id matched a real film in the payload — distinct from a bad id. When the
  // film exists but transformResponse drops it (all showtimes now in the past),
  // that is a finished run, not a broken link. See the two empty states below.
  const filmInPayload = data.listings.movies.some((m) => m.id === data.filmId);
  const movie = useMemo(() => {
    const movies = transformResponse(data.listings, now);
    return movies.find((m) => m.id === data.filmId) ?? null;
  }, [data.listings, data.filmId, now]);

  const { coords, active, error, resolving, toggle } = useLocationPin();

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
              <FilmView
                movie={movie}
                coords={coords}
                now={now}
                generatedAt={data.listings.generated_at}
                stale={data.listings.stale}
                locationActive={active}
                locationError={error}
                locationResolving={resolving}
                onToggleLocation={toggle}
              />
            ) : (
              <div className="detail-screen">
                <div className="empty-state empty-state--center">
                  {filmInPayload ? (
                    <>
                      <div className="empty-state__overline">Finished its run</div>
                      <div className="empty-state__heading">This film has wrapped</div>
                      <div className="empty-state__body">
                        Its remaining showtimes have all passed. It may return — see
                        what's on now.
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="empty-state__overline">Not found</div>
                      <div className="empty-state__heading">This film isn't showing</div>
                      <div className="empty-state__body">
                        The link may be out of date.
                      </div>
                    </>
                  )}
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
  generatedAt: string | null;
  stale: boolean;
  locationActive: boolean;
  locationError: boolean;
  locationResolving: boolean;
  onToggleLocation: () => void;
}

function FilmView({
  movie,
  coords,
  now,
  generatedAt,
  stale,
  locationActive,
  locationError,
  locationResolving,
  onToggleLocation,
}: FilmViewProps) {
  const { dark, toggle: toggleDark } = useTheme();
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
  const [sheetVenue, setSheetVenue] = useState<SheetVenueData | null>(null);
  const rafRef = useRef<number | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Prefer real browser back so the list restores its scroll + filters via
  // bfcache; fall back to the home document on a cold deep-link entry.
  // history.length alone isn't enough: arriving in the same tab from Google or
  // a chat app leaves a populated history whose previous entry is that other
  // site, so "Back" would leave the app entirely. Only step back when the
  // referrer says we came from here.
  const onBack = () => {
    const cameFromApp =
      document.referrer !== "" && new URL(document.referrer).origin === window.location.origin;
    if (cameFromApp && window.history.length > 1) window.history.back();
    else window.location.assign("/");
  };

  const activeDays = useMemo(
    () => new Set(movie.showtimes.map((s) => s.dayOffset)),
    [movie.showtimes],
  );

  const days = useMemo(() => generateDays(now, dayHorizon([movie])), [now, movie]);

  // Sort nearest-first on live coords so order and distance labels agree. Coords
  // are null on the server + first client render (geolocation resolves in an
  // effect), so SSG and first hydration both render alphabetical, then the rows
  // re-sort once coords arrive — same deferred pattern as the labels.
  const daySections = useMemo(
    () => buildDaySections(movie, selectedDay, coords, now),
    [movie, selectedDay, coords, now],
  );

  const showtimeCount = movie.showtimes.filter(
    (s) => selectedDay == null || s.dayOffset === selectedDay,
  ).length;

  // Distinct cinemas across the whole run, not per day — a cinema showing the
  // film on three days is still one cinema in the summary line.
  const cinemaCount = useMemo(
    () => new Set(daySections.flatMap((d) => d.cinemas.map((c) => c.theater.id))).size,
    [daySections],
  );

  // Amber pills mean "bookable" — a colour-only code nothing on the page
  // explained. Only worth a legend when some row actually carries it.
  const anyBookable = useMemo(
    () => daySections.some((d) => d.cinemas.some((c) => c.times.some((t) => t.bookingUrl))),
    [daySections],
  );

  const meta = formatMovieMeta(movie, true);
  const originalLanguage = formatLanguage(movie.original_lang);

  const letterboxdHref = movie.links.imdb_id
    ? `https://letterboxd.com/imdb/${movie.links.imdb_id}/`
    : `https://letterboxd.com/search/${encodeURIComponent(`${movie.title}${movie.year != null ? ` ${movie.year}` : ""}`)}`;
  const rtHref = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(movie.title)}`;
  const metacriticHref = `https://www.metacritic.com/search/${encodeURIComponent(movie.title)}/`;

  // Detail scrolls the document body (so iOS Safari pull-to-refresh works).
  // No manual scroll reset: this is its own document, loaded at the top on
  // forward nav and restored natively (bfcache) on back.
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

  // Backdrop fade, off the React render path: write opacity straight to the DOM
  // inside a rAF-throttled scroll listener. Same ramp as before (1 → 0 over the
  // first 130px). Once fully faded we stop touching the DOM until the user
  // scrolls back up into the ramp.
  useEffect(() => {
    const el = backdropRef.current;
    if (el == null) return;
    const apply = () => {
      rafRef.current = null;
      const opacity = Math.max(0, 1 - window.scrollY / 130);
      if (opacity === 0 && el.style.opacity === "0") return;
      el.style.opacity = String(opacity);
    };
    const onScroll = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(apply);
    };
    apply(); // sync initial state (e.g. reload while already scrolled)
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
      <div className="detail-backdrop" ref={backdropRef}>
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
        <div className="detail-backdrop-gradient" />
      </div>

      {/* Back button + theme toggle. The toggle is repeated here because a film
          page is a landing page in its own right (search results, shared links),
          and its visitor would otherwise have no way to change the theme
          without first navigating to the list. */}
      <button className="detail-back-btn" onClick={onBack} aria-label="Back">
        <BackIcon />
        <span>Back</span>
      </button>
      <button
        className="detail-theme-btn"
        onClick={toggleDark}
        aria-pressed={dark}
        aria-label="Dark mode"
      >
        {dark ? <SunIcon /> : <MoonIcon />}
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
            <h2 className="showtimes-heading">Showtimes</h2>

            <DayPicker selectedDay={selectedDay} onSelect={setSelectedDay} activeDays={activeDays} days={days} />

            {cinemaCount > 0 && (
              <div className="cinema-count" aria-live="polite">
                {`${showtimeCount} showtime${showtimeCount !== 1 ? "s" : ""} · ${cinemaCount} cinema${cinemaCount !== 1 ? "s" : ""}`}
                {/* Was a bare label reading "A–Z", styled like a control but
                    inert — and geolocation could only be granted from the list,
                    so a deep-linked visitor had no way to reach distance order. */}
                <button
                  className={`cinema-count__order${locationActive ? " cinema-count__order--active" : ""}`}
                  onClick={onToggleLocation}
                  aria-pressed={locationActive}
                  aria-label={locationActive ? "Sorted by distance" : "Sort cinemas by distance"}
                >
                  {locationError
                    ? "No location"
                    : locationResolving
                      ? "Locating…"
                      : locationActive
                        ? "Nearest first"
                        : "A–Z"}
                </button>
              </div>
            )}

            {anyBookable && (
              <p className="showtimes-legend">
                <span className="showtimes-legend__swatch" aria-hidden="true" />
                Highlighted times book online. Tap any time for calendar options.
              </p>
            )}

            {selectedDay != null && daySections.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state__body">No screenings on this day.</div>
              </div>
            ) : (
              daySections.map((section) => (
                <section key={section.offset} className="day-section">
                  {/* Day-first: one evening stays contiguous instead of being
                      scattered across every cinema block. Cinemas repeat per
                      day, which is the cheaper repetition — the day is what
                      people filter by first. */}
                  {selectedDay == null && (
                    <h3 className="day-section__h">
                      <span className="day-section__label">{section.label}</span>
                      <span className="day-section__count">
                        {section.cinemas.reduce((n, c) => n + c.times.length, 0)} showtimes ·{" "}
                        {section.cinemas.length} cinema{section.cinemas.length !== 1 ? "s" : ""}
                      </span>
                    </h3>
                  )}

                  {section.cinemas.map(({ theater, times, distKm }) => {
                    const dl = formatDistKm(distKm);
                    // "Book online" over-claimed when only some of a cinema's
                    // times were bookable — say which case it is.
                    const bookableCount = times.filter((t) => t.bookingUrl).length;
                    const bookLabel =
                      bookableCount === 0
                        ? null
                        : bookableCount === times.length
                          ? "Book online"
                          : "Some online";
                    // The open row's actions render once, below the whole grid
                    // (see .showtime__actions) rather than inside a grid cell —
                    // in-cell they stretched the entire grid row, leaving the
                    // sibling times floating above a void.
                    const openTime = times.find((t) => panelId(theater.id, t.key) === selectedPillKey);

                    // Badge hoisting: one cinema on one day usually screens a
                    // single viewing language — say it once on the header
                    // instead of on every pill.
                    const langs = new Set(times.map((t) => t.lang));
                    const isUniform = langs.size === 1;
                    const headerBadge = viewingLangLabel(isUniform ? [...langs][0] : null);

                    return (
                      <div key={theater.id} className="cinema-row">
                        {/* Heading wrapper for the rotor outline (H1 → H2 → H3 →
                            H4). `.cinema-row__h` sets `font: inherit` to
                            neutralise the UA heading size/weight so the row
                            renders byte-identically. (An inline style here would
                            be blocked by the strict CSP style-src.) */}
                        <h4 className="cinema-row__h">
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
                              {bookLabel && <span className="tag tag--accent">{bookLabel}</span>}
                              {headerBadge && <span className="tag">{headerBadge}</span>}
                              {dl && <span className="cinema-row__dist">{dl}</span>}
                              <ChevronRightIcon />
                            </div>
                          </button>
                        </h4>
                        <div className="cinema-row__times">
                          <div className="showtime-grid">
                            {times.map(({ key, t, bookingUrl, lang, formatBadge }) => (
                              <Showtime
                                key={key}
                                panelId={panelId(theater.id, key)}
                                selectedKey={selectedPillKey}
                                onSelect={setSelectedPillKey}
                                time={t}
                                dayLabel={section.label}
                                bookingUrl={bookingUrl}
                                badge={isUniform ? null : viewingLangLabel(lang, "short")}
                                formatBadge={formatBadge}
                                film={movie.title}
                                cinema={theater.name}
                              />
                            ))}
                          </div>
                          {openTime && (
                            <ShowtimeActions
                              id={panelId(theater.id, openTime.key)}
                              time={openTime.t}
                              date={openTime.date}
                              bookingUrl={openTime.bookingUrl}
                              film={movie.title}
                              cinema={theater.name}
                              address={theater.address}
                              runtimeMinutes={movie.runtime_minutes}
                              now={now}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))
            )}

            <div className="detail-bottom-spacer" />
          </div>
        </div>
      </div>

      <SiteFooter
        age={
          dataAgeLabel(generatedAt, stale, now) != null ? (
            <DataAge generatedAt={generatedAt} stale={stale} now={now} />
          ) : undefined
        }
      />
    </div>
  );
}

/** Stable DOM id for a showtime's actions panel — the pill key alone repeats
 * across cinemas, so the theater id is part of it. */
const panelId = (theaterId: string, pillKey: string) =>
  `showtime-actions-${theaterId}-${pillKey}`.replace(/[^a-zA-Z0-9_-]/g, "-");

/**
 * One showtime, as a single atomic block: the time on top, its attribute tags
 * on a subline inside the same border. Bookable showtimes get a filled body
 * (primary tap = seat picker) plus an attached chevron segment that reveals the
 * secondary actions — never a detached sibling control.
 *
 * The revealed panel is *not* rendered here: it lives below the whole grid (see
 * `ShowtimeActions`), because a panel inside a grid cell stretched the entire
 * grid row and left the sibling times floating over a void.
 */
function Showtime({
  time,
  dayLabel,
  bookingUrl,
  badge,
  formatBadge,
  film,
  cinema,
  panelId,
  selectedKey,
  onSelect,
}: {
  time: string;
  /** Day-group label ("Thu 23"); null when the page is filtered to one day. */
  dayLabel: string | null;
  bookingUrl?: string;
  badge: string | null;
  formatBadge: string | null;
  film: string;
  cinema: string;
  panelId: string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  // Selection identity must be theater-scoped: pillKey (`${dayOffset}-${time}`)
  // repeats across cinemas, so keying selection on it alone expands every row
  // sharing that time. panelId already carries the theater id — reuse it.
  const isSelected = panelId === selectedKey;
  const when = dayLabel ? `${time} on ${dayLabel}` : time;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(isSelected ? null : panelId);
  };

  const body = (
    <>
      <time className="showtime__time">{time}</time>
      {(badge || formatBadge) && (
        <span className="showtime__sub">
          {badge && <span className="showtime__tag showtime__tag--subs">{badge}</span>}
          {formatBadge && <span className="showtime__tag showtime__tag--format">{formatBadge}</span>}
        </span>
      )}
    </>
  );

  return (
    <div className="showtime">
      <div
        className={`showtime__box${bookingUrl ? " showtime__box--book" : ""}${isSelected ? " showtime__box--selected" : ""}`}
      >
        {bookingUrl ? (
          <>
            <a
              href={bookingUrl}
              target="_blank"
              rel="noreferrer"
              className="showtime__main"
              aria-label={`Buy tickets for ${film} at ${cinema}, ${when}`}
            >
              {body}
            </a>
            <button
              className="showtime__more"
              onClick={handleToggle}
              aria-expanded={isSelected}
              aria-controls={panelId}
              aria-label={`More options for ${when} at ${cinema}`}
            >
              <ChevronDownIcon />
            </button>
          </>
        ) : (
          <button
            className="showtime__main"
            onClick={handleToggle}
            aria-expanded={isSelected}
            aria-controls={panelId}
            aria-label={`${when} at ${cinema}`}
          >
            {body}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Secondary actions for the one open showtime, rendered full-width under its
 * cinema's grid. Only ever one is mounted, so building the iCalendar document
 * here costs one doc per open row rather than ~159 unused ones per re-render.
 *
 * "Book tickets" is deliberately absent when the row is bookable: tapping the
 * pill body already opens the seat picker, so repeating it here would be a
 * second control for an action the visitor just declined to take.
 */
function ShowtimeActions({
  id,
  time,
  date,
  bookingUrl,
  film,
  cinema,
  address,
  runtimeMinutes,
  now,
}: {
  id: string;
  time: string;
  date: string;
  bookingUrl?: string;
  film: string;
  cinema: string;
  address: string;
  runtimeMinutes: number | null;
  now: Date;
}) {
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

  return (
    <div id={id} className="showtime__actions" role="group" aria-label={`Options for ${time}`}>
      {/* Names its subject: the panel sits under a grid of times, so without it
          there is nothing saying which one was opened. */}
      <span className="showtime__actions-note">
        <strong>{time}</strong>
        {bookingUrl ? "" : " · no online booking, buy at the box office"}
      </span>
      <a
        href={icsHref(ics)}
        download={calName}
        className="showtime__action"
        onClick={(e) => e.stopPropagation()}
      >
        Add to calendar
      </a>
    </div>
  );
}

function FaviconLink({ icon, label, href }: { icon: string; label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="ext-link">
      <img src={icon} width={14} height={14} alt="" className="ext-link__icon" />
      {label}
    </a>
  );
}
