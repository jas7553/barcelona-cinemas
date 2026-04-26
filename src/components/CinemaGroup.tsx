import PosterPlaceholder from "./PosterPlaceholder";
import { isLastChance, formatDistKm } from "../utils";
import type { CinemaViewGroup, TransformedMovie } from "../types";

interface Props {
  group: CinemaViewGroup;
  onFilmTap: (movie: TransformedMovie) => void;
}

export default function CinemaGroup({ group, onFilmTap }: Props) {
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
          <a
            key={movie.id}
            href={`#/film/${movie.id}`}
            className="cinema-group__film"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) return;
              e.preventDefault();
              onFilmTap(movie);
            }}
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
                  <div key={t} className={`time-pill${lc ? " time-pill--lc" : ""}`}>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
