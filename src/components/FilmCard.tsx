import { memo } from "react";
import { Link, useLocation } from "react-router-dom";
import PosterPlaceholder from "./PosterPlaceholder";
import { isLastChance, formatMovieMeta } from "../utils";
import type { TransformedMovie } from "../types";

interface Props {
  movie: TransformedMovie;
  dayOffset?: number;
}

function FilmCard({ movie, dayOffset }: Props) {
  const location = useLocation();
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

  return (
    <Link
      to={{ pathname: `/film/${movie.id}`, search: location.search }}
      className={`film-card${lc ? " film-card--lc" : ""}${showTimes ? " film-card--with-times" : ""}`}
    >
      {movie.poster_url ? (
        <img
          src={movie.poster_url}
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
          </div>
        )}
      </div>
    </Link>
  );
}

export default memo(FilmCard);
