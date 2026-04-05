import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { fetchListings } from "./api";
import type { FilmDiscovery, Theater, TransformedMovie } from "./types";
import { computeFilmDiscovery, transformResponse } from "./utils";
import DiscoverView from "./views/DiscoverView";
import ShowtimesView from "./views/ShowtimesView";

export interface SharedProps {
  movies: TransformedMovie[];
  theaters: Theater[];
  genres: string[];
  filmDiscovery: FilmDiscovery[];
  generatedAt: string | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export default function App() {
  const [movies, setMovies] = useState<TransformedMovie[]>([]);
  const [theaters, setTheaters] = useState<Theater[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchListings()
      .then((data) => {
        setMovies(transformResponse(data));
        setTheaters(data.theaters);
        setGeneratedAt(data.generated_at);
        setStale(data.stale);
      })
      .catch(() => setError("fetch failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchListings()
      .then((data) => {
        if (cancelled) return;
        setMovies(transformResponse(data));
        setTheaters(data.theaters);
        setGeneratedAt(data.generated_at);
        setStale(data.stale);
      })
      .catch(() => {
        if (!cancelled) setError("fetch failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const m of movies) for (const g of m.genres) set.add(g);
    return [...set].sort();
  }, [movies]);

  const filmDiscovery = useMemo(() => computeFilmDiscovery(movies), [movies]);

  const shared: SharedProps = {
    movies,
    theaters,
    genres,
    filmDiscovery,
    generatedAt,
    stale,
    loading,
    error,
    onRetry: load,
  };

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/films" replace />} />
      <Route path="/films" element={<DiscoverView {...shared} />} />
      <Route path="/showtimes" element={<ShowtimesView {...shared} />} />
      <Route path="*" element={<Navigate to="/films" replace />} />
    </Routes>
  );
}
