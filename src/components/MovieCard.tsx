import type { Movie } from "../types";
import { fmtRuntime } from "../utils";
import { SynopsisBlock } from "./SynopsisBlock";
import { ShowtimesBlock } from "./ShowtimesBlock";

interface Props {
  movie: Movie;
}

export function MovieCard({ movie }: Props) {
  return (
    <article className="card">
      <div className="card-header">
        <h2 className="card-title">{movie.title}</h2>
        {movie.rating != null && (
          <span className="card-rating">★&nbsp;{movie.rating.toFixed(1)}</span>
        )}
      </div>

      {(movie.genres?.length || movie.runtime_mins) && (
        <p className="card-meta">
          {movie.genres?.map((g, i) => (
            <span key={g}>
              {i > 0 && <span className="meta-sep"> · </span>}
              <span className="genre-pill">{g}</span>
            </span>
          ))}
          {movie.genres?.length && movie.runtime_mins && (
            <span className="meta-sep"> · </span>
          )}
          {movie.runtime_mins && (
            <span className="runtime">{fmtRuntime(movie.runtime_mins)}</span>
          )}
        </p>
      )}

      {movie.synopsis && <SynopsisBlock text={movie.synopsis} />}

      <ShowtimesBlock showtimes={movie.showtimes} />
    </article>
  );
}
