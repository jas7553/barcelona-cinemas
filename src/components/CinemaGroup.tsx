import { Link } from "react-router-dom";
import PosterPlaceholder from "./PosterPlaceholder";
import { isLastChance, formatDistKm } from "../utils";
import type { CinemaViewGroup } from "../types";

interface Props {
  group: CinemaViewGroup;
}

export default function CinemaGroup({ group }: Props) {
  const distLabel = formatDistKm(group.distanceKm);

  return (
    <div className="cinema-group">
      <div className="cinema-group__header">
        <span className="cinema-group__name">{group.theaterName}</span>
        {distLabel && <span className="cinema-group__dist">{distLabel}</span>}
      </div>

      {group.films.map(({ movie, times }) => {
        const lc = isLastChance(movie);
        return (
          <Link
            key={movie.id}
            to={`/film/${movie.id}`}
            className="cinema-group__film"
          >
            {movie.poster_url ? (
              <img
                src={movie.poster_url}
                alt={movie.title}
                width={36}
                height={52}
                style={{ objectFit: "cover", flexShrink: 0, borderRadius: 2 }}
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
