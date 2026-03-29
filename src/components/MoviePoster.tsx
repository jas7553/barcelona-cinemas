import { useState } from "react";

interface Props {
  title: string;
  posterUrl: string | null;
}

function getPosterMonogram(title: string): string {
  const parts = title
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);

  if (parts.length === 0) return "FILM";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
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
          <span className="movie-poster-monogram">{getPosterMonogram(title)}</span>
          <span className="movie-poster-title">{title}</span>
        </div>
      )}
    </div>
  );
}
