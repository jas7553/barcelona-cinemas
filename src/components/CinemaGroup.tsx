import { memo } from "react";
import PosterPlaceholder from "./PosterPlaceholder";
import { ChevronRightIcon } from "./Icons";
import { isLastChance, formatDistKm, thumbPosterUrl } from "../utils";
import type { CinemaViewGroup } from "../types";

/** Day rows shown inline before the rest collapse into a "+N more days" note. */
const MAX_DAYS = 2;

interface Props {
  group: CinemaViewGroup;
  onCinemaTap: (group: CinemaViewGroup, distLabel: string | null) => void;
  /** Day chips from the page clock, for labelling each day row. */
  days: Array<{ label: string; offset: number }>;
  /** Current list query string (e.g. "?day=2"), carried into the detail URL. */
  search?: string;
}

function CinemaGroup({ group, onCinemaTap, days, search = "" }: Props) {
  const distLabel = formatDistKm(group.distanceKm);
  const dayLabels = new Map(days.map((d) => [d.offset, d.label]));

  return (
    <div className="cinema-group">
      <button
        className="cinema-group__header"
        onClick={() => onCinemaTap(group, distLabel)}
      >
        <span className="cinema-group__name">{group.theater.name}</span>
        <span className="cinema-group__right">
          {distLabel && <span className="cinema-group__dist">{distLabel}</span>}
          <ChevronRightIcon />
        </span>
      </button>

      {group.films.map(({ movie, days: filmDays }) => {
        const lc = isLastChance(movie);
        const shown = filmDays.slice(0, MAX_DAYS);
        const extraDays = filmDays.length - shown.length;
        return (
          <a
            key={movie.id}
            href={`/film/${movie.id}${search}`}
            className="cinema-group__film"
          >
            {movie.poster_url ? (
              <img
                src={thumbPosterUrl(movie.poster_url)!}
                alt={movie.title}
                width={36}
                height={52}
                loading="lazy"
                decoding="async"
                className="cinema-group__film-poster"
              />
            ) : (
              <PosterPlaceholder w={36} h={52} id={movie.id} />
            )}
            <div className="cinema-group__film-body">
              <div className="cinema-group__film-title-row">
                <span className="cinema-group__film-title">{movie.title}</span>
                {lc && <div className="leaving-soon-badge">Leaving soon</div>}
              </div>
              {shown.map(({ offset, times }) => (
                <div key={offset} className="cinema-group__film-day">
                  {offset >= 0 && (
                    <span className="cinema-group__film-day-label">
                      {dayLabels.get(offset) ?? ""}
                    </span>
                  )}
                  <div className="cinema-group__film-times">
                    {times.map((t) => (
                      <time key={t} className={`time-pill${lc ? " time-pill--lc" : ""}`}>
                        {t}
                      </time>
                    ))}
                  </div>
                </div>
              ))}
              {extraDays > 0 && (
                <div className="cinema-group__film-more">
                  +{extraDays} more day{extraDays !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          </a>
        );
      })}
    </div>
  );
}

export default memo(CinemaGroup);
