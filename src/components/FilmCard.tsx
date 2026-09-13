import { memo } from "react";
import PosterPlaceholder from "./PosterPlaceholder";
import {
  screeningKind,
  runCoverageLabel,
  formatMovieMeta,
  premiumFormatLabel,
  thumbPosterUrl,
} from "../utils";
import type { TransformedMovie } from "../types";

interface Props {
  movie: TransformedMovie;
  dayOffset?: number;
  /** Day chips from the page clock, for labelling the next showing / coverage. */
  days?: Array<{ label: string; offset: number }>;
  /** Current list query string (e.g. "?day=2"), carried into the detail URL. */
  search?: string;
}

function FilmCard({ movie, dayOffset, days, search = "" }: Props) {
  const kind = screeningKind(movie);
  const oneOff = kind === "one-off";

  const filtered =
    dayOffset != null
      ? movie.showtimes.filter((s) => s.dayOffset === dayOffset)
      : movie.showtimes;

  const dayTimes = [...new Set(filtered.map((s) => s.time))].sort();
  const dateByTime = new Map(filtered.map((s) => [s.time, s.date]));
  const cinemaCount = new Set(filtered.map((s) => s.theater.id)).size;

  // A popular film can have 16+ distinct times on one day — cap the pills;
  // the detail screen has the full per-cinema breakdown
  const MAX_PILLS = 6;
  const shownTimes = dayTimes.slice(0, MAX_PILLS);
  const extraTimes = dayTimes.length - shownTimes.length;

  const meta = formatMovieMeta(movie);
  const showTimes = dayOffset !== undefined && dayTimes.length > 0;

  // Day-scoped for free: `filtered` is already the selected day's showtimes.
  const fmt = showTimes
    ? premiumFormatLabel(filtered.find((s) => s.premium_format)?.premium_format)
    : null;

  const sortedShowtimes = [...movie.showtimes].sort(
    (a, b) => a.dayOffset - b.dayOffset || a.time.localeCompare(b.time),
  );
  const oneOffShowings = sortedShowtimes.slice(0, 2);
  const dayLabel = (offset: number) => days?.find((d) => d.offset === offset)?.label ?? "";

  const coverageLabel = !oneOff && !showTimes && days ? runCoverageLabel(movie, days) : null;

  return (
    <a
      href={`/film/${movie.id}${search}`}
      className={`film-card${showTimes ? " film-card--with-times" : ""}`}
    >
      {movie.poster_url ? (
        <img
          src={thumbPosterUrl(movie.poster_url)!}
          alt={movie.title}
          className="film-card__poster"
          width={72}
          height={106}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="film-card__poster-wrap">
          <PosterPlaceholder w={72} h={106} id={movie.id} />
        </div>
      )}

      <div className="film-card__body">
        <div>
          <div className="film-card__title-row">
            <div className="film-card__title">{movie.title}</div>
          </div>
          {meta && <div className="film-card__meta">{meta}</div>}
          <div className="film-card__rating">
            {movie.rating != null && <>★ {movie.rating.toFixed(1)} · </>}
            {cinemaCount} {cinemaCount === 1 ? "cinema" : "cinemas"}
          </div>
        </div>
        {showTimes ? (
          oneOff ? (
            <>
              {filtered.map((s) => (
                <div key={`${s.date}-${s.time}-${s.theater.id}`} className="film-card__next">
                  {s.time} · {s.theater.name}
                </div>
              ))}
            </>
          ) : (
            <div className="film-card__times">
              {shownTimes.map((t) => {
                const d = dateByTime.get(t);
                return (
                  <time key={t} className="time-pill" dateTime={d ? `${d}T${t}` : t}>
                    {t}
                  </time>
                );
              })}
              {extraTimes > 0 && (
                <span className="time-pill time-pill--more">+{extraTimes} more</span>
              )}
              {fmt && <span className="tag">{fmt}</span>}
            </div>
          )
        ) : oneOff ? (
          <>
            {oneOffShowings.map((s) => (
              <div key={`${s.date}-${s.time}-${s.theater.id}`} className="film-card__next">
                {dayLabel(s.dayOffset)} · {s.time} · {s.theater.name}
              </div>
            ))}
          </>
        ) : (
          coverageLabel && <div className="film-card__next">{coverageLabel}</div>
        )}
      </div>
    </a>
  );
}

export default memo(FilmCard);
