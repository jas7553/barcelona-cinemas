import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { fetchListings } from "./api";
import type { Listings, TransformedMovie } from "./types";
import { transformResponse } from "./utils";
import { useLocationPin } from "./hooks/useLocationPin";
import MainList from "./views/MainList";
import SearchScreen from "./views/SearchScreen";
import FilmDetail from "./views/FilmDetail";

function AppInner() {
  const { dark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const screen =
    location.pathname.startsWith("/film/") ? "detail"
    : location.pathname === "/search" ? "search"
    : "list";
  const [movies, setMovies] = useState<TransformedMovie[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const locationRequested = useRef(false);

  const { coords, active: locationActive, toggle: toggleLocation } = useLocationPin();

  const applyListings = useCallback((data: Listings) => {
    setMovies(transformResponse(data));
    setGeneratedAt(data.generated_at);
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

  const selectedFilmId = screen === "detail" ? location.pathname.slice("/film/".length) : null;
  const selectedFilm = useMemo(
    () => (selectedFilmId ? (movies.find((m) => m.id === selectedFilmId) ?? null) : null),
    [selectedFilmId, movies],
  );

  useEffect(() => {
    if (screen === "detail" && !locationActive && !locationRequested.current) {
      locationRequested.current = true;
      toggleLocation();
    }
  }, [screen, locationActive, toggleLocation]);

  useEffect(() => {
    if (screen === "detail" && selectedFilm) {
      document.title = `${selectedFilm.title} · Barcelona This Week`;
    } else if (screen === "search") {
      document.title = "Search · Barcelona This Week";
    } else {
      document.title = "Barcelona This Week";
    }
  }, [screen, selectedFilm]);

  const onFilmSelect = useCallback(() => {}, []);

  return (
    <div className={`app-wrapper${dark ? " dark" : ""}`}>
      <div className="app-shell">
        {screen === "list" && (
          <div className="screen">
            <MainList
              movies={movies}
              loading={loading}
              error={error}
              generatedAt={generatedAt}
              coords={coords}
              onFilmSelect={onFilmSelect}
              onSearch={() => navigate("/search")}
              onRetry={load}
            />
          </div>
        )}
        {screen === "search" && (
          <div className="screen">
            <SearchScreen
              movies={movies}
              isActive
              onFilmSelect={onFilmSelect}
              onCancel={() => navigate("/")}
            />
          </div>
        )}
        {screen === "detail" && selectedFilm && (
          <div className="screen">
            <FilmDetail
              key={selectedFilm.id}
              movie={selectedFilm}
              coords={coords}
              onBack={() => navigate("/")}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </BrowserRouter>
  );
}
