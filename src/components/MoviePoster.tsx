import { useRef, useState } from "react";

interface Props {
  title: string;
  posterUrl: string | null;
}

export default function MoviePoster({ title, posterUrl }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const [glow, setGlow] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const showImage = Boolean(posterUrl) && !imageFailed;

  function handleCorsLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = 1;
      canvas.height = 1;
      ctx.drawImage(e.currentTarget, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      setGlow(`rgba(${r},${g},${b},0.45)`);
    } catch {
      // CORS or security error — no glow
    }
  }

  return (
    <div
      className="movie-poster"
      aria-hidden="true"
      style={glow ? { boxShadow: `0 0 18px 2px ${glow}` } : undefined}
    >
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {/* Hidden CORS image used only for color sampling — never shown */}
      {posterUrl && (
        <img
          src={posterUrl}
          alt=""
          crossOrigin="anonymous"
          style={{ display: "none" }}
          onLoad={handleCorsLoad}
        />
      )}
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
