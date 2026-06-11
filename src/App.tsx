import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { fetchListings } from "./api";
import type { TransformedMovie } from "./types";
import { transformResponse } from "./utils";
import { useLocationPin } from "./hooks/useLocationPin";
import MainList from "./views/MainList";
import FilmDetail from "./views/FilmDetail";

function AppInner() {
  const { dark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const screen =
    location.pathname.startsWith("/film/") ? "detail"
    : "list";
  const [movies, setMovies] = useState<TransformedMovie[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const locationRequested = useRef(false);

  const { coords, active: locationActive, resolving: locationResolving, toggle: toggleLocation } = useLocationPin();

  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    fetchListings()
      .then((data) => {
        setMovies(transformResponse(data));
        setGeneratedAt(data.generated_at);
        setStale(data.stale);
        setLoading(false);
      })
      .catch(() => {
        setError("fetch failed");
        setLoading(false);
      });
  }, [fetchKey]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setFetchKey((k) => k + 1);
  }, []);

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
    } else {
      document.title = "Barcelona This Week";
    }
  }, [screen, selectedFilm]);

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
              stale={stale}
              coords={coords}
              locationResolving={locationResolving}
              onRetry={load}
            />
          </div>
        )}
        {screen === "detail" && selectedFilm && (
          <div className="screen">
            <FilmDetail
              key={selectedFilm.id}
              movie={selectedFilm}
              coords={coords}
              onBack={() => {
                // Preserve list filters + scroll by going back in history when we can
                if (location.key !== "default") void navigate(-1);
                else void navigate("/");
              }}
            />
          </div>
        )}
        {screen === "detail" && !selectedFilm && (
          <div className="screen">
            {loading ? (
              <div className="loading-pulse" role="status" aria-label="Loading film">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="loading-card" />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state__overline">Not found</div>
                <div className="empty-state__heading">This film isn't showing</div>
                <div className="empty-state__body">
                  It may have finished its run, or the link is out of date.
                </div>
                <button className="empty-state__btn" onClick={() => navigate("/")}>
                  See what's on
                </button>
              </div>
            )}
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
