import { useState } from "react";

interface Props {
  title: string;
  posterUrl: string | null;
}

export default function MoviePoster({ title, posterUrl }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(posterUrl) && !imageFailed;

  return (
    <div className="movie-poster" aria-hidden="true">
      {showImage ? (
        <img
          className="movie-poster-image"
          data-testid="movie-poster-image"
          src={posterUrl ?? undefined}
          alt=""
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="movie-poster-fallback" data-testid="movie-poster-fallback">
          <span className="movie-poster-letter">
            {title[0]?.toUpperCase() ?? "?"}
          </span>
        </div>
      )}
    </div>
  );
}
