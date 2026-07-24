import { memo } from "react";
import PosterPlaceholder from "./PosterPlaceholder";
import {
  isLastChance,
  formatMovieMeta,
  premiumFormatLabel,
  thumbPosterUrl,
} from "../utils";
import type { TransformedMovie } from "../types";

interface Props {
  movie: TransformedMovie;
  dayOffset?: number;
  /** Day chips from the page clock, for labelling the next showing. */
  days?: Array<{ label: string; offset: number }>;
  /** Current list query string (e.g. "?day=2"), carried into the detail URL. */
  search?: string;
}

function FilmCard({ movie, dayOffset, days, search = "" }: Props) {
  const lc = isLastChance(movie);

  const filtered =
    dayOffset != null
      ? movie.showtimes.filter((s) => s.dayOffset === dayOffset)
      : movie.showtimes;

  const dayTimes = [...new Set(filtered.map((s) => s.time))].sort();
  const cinemaCount = new Set(filtered.map((s) => s.theater.id)).size;

  // A popular film can have 16+ distinct times on one day — cap the pills;
  // the detail screen has the full per-cinema breakdown
  const MAX_PILLS = 6;
  const shownTimes = dayTimes.slice(0, MAX_PILLS);
  const extraTimes = dayTimes.length - shownTimes.length;

  const meta = formatMovieMeta(movie);
  const showTimes = dayOffset !== undefined && dayTimes.length > 0;

  // Unfiltered, the card used to carry no time at all — the default landing
  // state was the least informative one. Times across a whole week can't be
  // listed honestly, but the very next screening can.
  const next = showTimes
    ? null
    : movie.showtimes.reduce<TransformedMovie["showtimes"][number] | null>(
        (best, s) =>
          best == null || s.dayOffset < best.dayOffset || (s.dayOffset === best.dayOffset && s.time < best.time)
            ? s
            : best,
        null,
      );
  const nextLabel =
    next && days ? `${days.find((d) => d.offset === next.dayOffset)?.label ?? ""} ${next.time}`.trim() : null;

  // Day-scoped for free: `filtered` is already the selected day's showtimes.
  const fmt = showTimes
    ? premiumFormatLabel(filtered.find((s) => s.premium_format)?.premium_format)
    : null;

  return (
    <a
      href={`/film/${movie.id}${search}`}
      className={`film-card${lc ? " film-card--lc" : ""}${showTimes ? " film-card--with-times" : ""}`}
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
            {lc && <div className="leaving-soon-badge">Leaving soon</div>}
          </div>
          {meta && <div className="film-card__meta">{meta}</div>}
          <div className="film-card__rating">
            {movie.rating != null && <>★ {movie.rating.toFixed(1)} · </>}
            {cinemaCount} {cinemaCount === 1 ? "cinema" : "cinemas"}
          </div>
        </div>
        {showTimes && (
          <div className="film-card__times">
            {shownTimes.map((t) => (
              <time key={t} className={`time-pill${lc ? " time-pill--lc" : ""}`}>
                {t}
              </time>
            ))}
            {extraTimes > 0 && (
              <span className="time-pill time-pill--more">+{extraTimes} more</span>
            )}
            {fmt && <span className="tag">{fmt}</span>}
          </div>
        )}
        {nextLabel && (
          <div className="film-card__next">
            Next <time className={`time-pill${lc ? " time-pill--lc" : ""}`}>{nextLabel}</time>
          </div>
        )}
      </div>
    </a>
  );
}

export default memo(FilmCard);
