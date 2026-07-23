import { memo } from "react";
import PosterPlaceholder from "./PosterPlaceholder";
import { ChevronRightIcon } from "./Icons";
import { isLastChance, formatDistKm, thumbPosterUrl } from "../utils";
import type { CinemaViewGroup } from "../types";

interface Props {
  group: CinemaViewGroup;
  onCinemaTap: (group: CinemaViewGroup, distLabel: string | null) => void;
  /** Current list query string (e.g. "?day=2"), carried into the detail URL. */
  search?: string;
}

function CinemaGroup({ group, onCinemaTap, search = "" }: Props) {
  const distLabel = formatDistKm(group.distanceKm);

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

      {group.films.map(({ movie, times }) => {
        const lc = isLastChance(movie);
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
              <div className="cinema-group__film-times">
                {times.map((t) => (
                  <time key={t} className={`time-pill${lc ? " time-pill--lc" : ""}`}>
                    {t}
                  </time>
                ))}
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}

export default memo(CinemaGroup);
