import PosterPlaceholder from "./PosterPlaceholder";
import { isLastChance } from "../utils";
import type { TransformedMovie } from "../types";

interface Props {
  movie: TransformedMovie;
  dayOffset?: number;
  onTap: (movie: TransformedMovie) => void;
}

export default function FilmCard({ movie, dayOffset, onTap }: Props) {
  const lc = isLastChance(movie);

  const filtered =
    dayOffset != null
      ? movie.showtimes.filter((s) => s.dayOffset === dayOffset)
      : movie.showtimes;

  const dayTimes = [...new Set(filtered.map((s) => s.time))].sort();
  const cinemaCount = new Set(filtered.map((s) => s.theater.id)).size;

  const genre = movie.genres.slice(0, 2).join(" · ");
  const meta = [genre, movie.year?.toString()].filter(Boolean).join(" · ");

  return (
    <a
      href={`#/film/${movie.id}`}
      className={`film-card${lc ? " film-card--lc" : ""}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        onTap(movie);
      }}
    >
      {movie.poster_url ? (
        <img
          src={movie.poster_url}
          alt={movie.title}
          width={72}
          height={106}
          style={{ objectFit: "cover", flexShrink: 0 }}
        />
      ) : (
        <PosterPlaceholder w={72} h={106} id={movie.id} />
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
        {dayOffset !== undefined && dayTimes.length > 0 && (
          <div className="film-card__times">
            {dayTimes.map((t) => (
              <div key={t} className={`time-pill${lc ? " time-pill--lc" : ""}`}>
                {t}
              </div>
            ))}
          </div>
        )}
      </div>
    </a>
  );
}
