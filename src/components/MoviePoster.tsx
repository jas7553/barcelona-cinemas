import { useState } from "react";

interface Props {
  title: string;
  posterUrl: string | null;
}

function getTitleHue(title: string): number {
  let h = 0;
  for (const c of title) h = c.charCodeAt(0) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

export default function MoviePoster({ title, posterUrl }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(posterUrl) && !imageFailed;
  const hue = getTitleHue(title);

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
        <div
          className="movie-poster-fallback"
          data-testid="movie-poster-fallback"
          style={{
            background: `linear-gradient(145deg, hsl(${hue},30%,85%), hsl(${(hue + 30) % 360},25%,75%))`,
          }}
        >
          <span
            className="movie-poster-letter"
            style={{ color: `hsl(${hue},20%,55%)` }}
          >
            {title[0]?.toUpperCase() ?? "?"}
          </span>
        </div>
      )}
    </div>
  );
}
