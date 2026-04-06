import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { fetchListings } from "./api";
import type { Theater, TransformedMovie } from "./types";
import { transformResponse } from "./utils";
import { useHiddenFilms } from "./hooks/useHiddenFilms";
import { useGeolocation } from "./hooks/useGeolocation";
import ShowtimesView from "./views/ShowtimesView";

export interface SharedProps {
  movies: TransformedMovie[];
  theaters: Theater[];
  generatedAt: string | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  hiddenIds: Set<string>;
  onHide: (id: string) => void;
}

export default function App() {
  const [movies, setMovies] = useState<TransformedMovie[]>([]);
  const [theaters, setTheaters] = useState<Theater[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { hiddenIds, hideFilm, clearHidden } = useHiddenFilms();
  const coords = useGeolocation();

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
      .catch(() => { if (!cancelled) setError("fetch failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // "__clear__" is a sentinel value used by Footer to clear all hidden films
  const handleHide = useCallback((id: string) => {
    if (id === "__clear__") clearHidden();
    else hideFilm(id);
  }, [hideFilm, clearHidden]);

  const shared: SharedProps = {
    movies,
    theaters,
    generatedAt,
    stale,
    loading,
    error,
    onRetry: load,
    hiddenIds,
    onHide: handleHide,
  };

  return (
    <Routes>
      <Route path="/showtimes" element={<ShowtimesView {...shared} coords={coords} />} />
      <Route path="*" element={<Navigate to="/showtimes" replace />} />
    </Routes>
  );
}
