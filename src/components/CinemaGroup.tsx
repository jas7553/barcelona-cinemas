import { memo } from "react";
import { Link, useLocation } from "react-router-dom";
import PosterPlaceholder from "./PosterPlaceholder";
import { ChevronRightIcon } from "./Icons";
import { isLastChance, formatDistKm, thumbPosterUrl } from "../utils";
import type { CinemaViewGroup } from "../types";

interface Props {
  group: CinemaViewGroup;
  onCinemaTap: (group: CinemaViewGroup, distLabel: string | null) => void;
}

function CinemaGroup({ group, onCinemaTap }: Props) {
  const location = useLocation();
  const distLabel = formatDistKm(group.distanceKm);

  return (
    <div className="cinema-group">
      <button
        className="cinema-group__header"
        onClick={() => onCinemaTap(group, distLabel)}
      >
        <span className="cinema-group__name">{group.theaterName}</span>
        <span className="cinema-group__right">
          {distLabel && <span className="cinema-group__dist">{distLabel}</span>}
          <ChevronRightIcon />
        </span>
      </button>

      {group.films.map(({ movie, times }) => {
        const lc = isLastChance(movie);
        return (
          <Link
            key={movie.id}
            to={{ pathname: `/film/${movie.id}`, search: location.search }}
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
                style={{ objectFit: "cover", flexShrink: 0, borderRadius: 2, background: "var(--surface2)" }}
              />
            ) : (
              <PosterPlaceholder w={36} h={52} id={movie.id} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
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
          </Link>
        );
      })}
    </div>
  );
}

export default memo(CinemaGroup);
