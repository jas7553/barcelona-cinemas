import { useCallback, useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { fetchListings } from "./api";
import type { Listings, Theater, TransformedMovie } from "./types";
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
  onClearHidden: () => void;
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

  const applyListings = useCallback((data: Listings) => {
    setMovies(transformResponse(data));
    setTheaters(data.theaters);
    setGeneratedAt(data.generated_at);
    setStale(data.stale);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchListings()
      .then(applyListings)
      .catch(() => setError("fetch failed"))
      .finally(() => setLoading(false));
  }, [applyListings]);

  useEffect(() => {
    let cancelled = false;
    fetchListings()
      .then((data) => { if (!cancelled) applyListings(data); })
      .catch(() => { if (!cancelled) setError("fetch failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applyListings]);

  const shared: SharedProps = {
    movies,
    theaters,
    generatedAt,
    stale,
    loading,
    error,
    onRetry: load,
    hiddenIds,
    onHide: hideFilm,
    onClearHidden: clearHidden,
  };

  return (
    <Routes>
      <Route path="/" element={<ShowtimesView {...shared} coords={coords} />} />
    </Routes>
  );
}
