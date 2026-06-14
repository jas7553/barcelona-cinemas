import { useEffect, useMemo, useRef } from "react";
import FilmDetail from "../views/FilmDetail";
import { ThemeProvider } from "../context/ThemeContext";
import { useNow } from "../hooks/useClient";
import { useLocationPin } from "../hooks/useLocationPin";
import { transformResponse } from "../utils";
import type { Listings } from "../types";

export interface FilmPageData {
  /** Instant the page was pre-rendered (SSG); seeds the hydration clock. */
  renderedAt: string;
  /** Listings narrowed to this one film (movies: [film], theaters: used). */
  listings: Listings;
  filmId: string;
}

/**
 * Document root for `/film/<id>`. The detail data is embedded (no fetch), so
 * first paint shows real content — the Safari "no white flash on forward nav"
 * guarantee. Back is a real browser navigation (bfcache restores the list).
 */
export default function FilmPage({ data }: { data: FilmPageData }) {
  const now = useNow(data.renderedAt);
  const movie = useMemo(() => {
    const movies = transformResponse(data.listings, now);
    return movies.find((m) => m.id === data.filmId) ?? movies[0] ?? null;
  }, [data.listings, data.filmId, now]);

  const { coords, active, toggle } = useLocationPin();

  // Distance labels are nice-to-have: re-use geolocation only if the user has
  // already granted permission — never raise the system prompt uninvited
  // (matches the old App.tsx behaviour).
  const geoRequested = useRef(false);
  useEffect(() => {
    if (active || geoRequested.current) return;
    geoRequested.current = true;
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        if (status.state === "granted") toggle();
      })
      .catch(() => {});
  }, [active, toggle]);

  const onBack = () => {
    // Prefer real browser back so the list restores its scroll + filters via
    // bfcache; fall back to the home document on a cold deep-link entry.
    if (window.history.length > 1) window.history.back();
    else window.location.assign("/");
  };

  return (
    <ThemeProvider>
      <div className="app-wrapper">
        <div className="app-shell">
          <main className="screen">
            {movie ? (
              <FilmDetail movie={movie} coords={coords} now={now} onBack={onBack} />
            ) : (
              <div className="detail-screen">
                <div className="empty-state empty-state--center">
                  <div className="empty-state__overline">Not found</div>
                  <div className="empty-state__heading">This film isn't showing</div>
                  <div className="empty-state__body">
                    It may have finished its run, or the link is out of date.
                  </div>
                  <a className="empty-state__btn" href="/">
                    See what's on
                  </a>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
