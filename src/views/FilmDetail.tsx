import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import BackdropPlaceholder from "../components/BackdropPlaceholder";
import PosterPlaceholder from "../components/PosterPlaceholder";
import DayPicker from "../components/DayPicker";
import CinemaSheet from "../components/CinemaSheet";
import { BackIcon, ChevronRightIcon } from "../components/Icons";
import { formatDistKm, formatMovieMeta, buildCinemaRows } from "../utils";
import type { TransformedMovie, SheetVenueData } from "../types";

interface Props {
  movie: TransformedMovie;
  coords: { lat: number; lng: number } | null;
  onBack: () => void;
}

export default function FilmDetail({ movie, coords, onBack }: Props) {
  const [searchParams] = useSearchParams();
  // Carry the list's day filter into the detail view (only if this film plays that day)
  const [selectedDay, setSelectedDay] = useState<number | null>(() => {
    const raw = searchParams.get("day");
    if (raw === null || isNaN(Number(raw))) return null;
    const day = Number(raw);
    return movie.showtimes.some((s) => s.dayOffset === day) ? day : null;
  });
  const [scrollY, setScrollY] = useState(0);
  const [sheetVenue, setSheetVenue] = useState<SheetVenueData | null>(null);
  // Snapshot at mount — prevents jarring reorder when geolocation resolves after render
  const [sortCoords] = useState(coords);
  const contentRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const backdropOpacity = Math.max(0, 1 - scrollY / 130);

  const activeDays = useMemo(
    () => new Set(movie.showtimes.map((s) => s.dayOffset)),
    [movie.showtimes],
  );

  const cinemaRows = useMemo(
    () => buildCinemaRows(movie, selectedDay, sortCoords),
    [movie, selectedDay, sortCoords],
  );

  const meta = formatMovieMeta(movie, true);

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
