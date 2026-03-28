import { useEffect, useState } from "react";
import type { BannerState, CinemaRegistry, Movie } from "./types";
import { fetchCinemas, fetchListings } from "./api";
import { fmtDate, relativeTime } from "./utils";
import { Banner } from "./components/Banner";
import { ChipNav } from "./components/ChipNav";
import { MovieList } from "./components/MovieList";

const LS_KEY = "bcn_cinema_neighborhood";
const ERROR_BANNER: BannerState = {
  type: "error",
  message: "Couldn't load listings.",
};

export function App() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [cinemas, setCinemas] = useState<CinemaRegistry>({});
  const [activeNeighborhood, setActiveNeighborhood] = useState<string>(
    localStorage.getItem(LS_KEY) ?? "All"
  );
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  function applyListings(data: {
    stale?: boolean;
    fetched_at?: string;
    movies?: Movie[];
    error?: string;
  }) {
    if (data.error) {
      setBanner(ERROR_BANNER);
      return;
    }
    if (data.stale && data.fetched_at) {
      setBanner({
        type: "stale",
        message: `Showing cached listings from ${relativeTime(data.fetched_at)}.`,
      });
    } else {
      setBanner(null);
    }
    setMovies(data.movies ?? []);
    setFetchedAt(data.fetched_at ?? null);
  }

  useEffect(() => {
    void Promise.all([
      fetchCinemas()
        .then(setCinemas)
        .catch(() => undefined),
      fetchListings()
        .then(applyListings)
        .catch(() => setBanner(ERROR_BANNER))
        .finally(() => setLoading(false)),
    ]);
  }, []);

  const dates = movies.flatMap((m) => m.showtimes.map((s) => s.date)).sort();
  const weekRange =
    dates.length >= 2 ? `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}` : null;

  return (
    <>
      <header>
        <h1>Barcelona This Week</h1>
        {weekRange && <p className="week-range">{weekRange}</p>}
      </header>

      <Banner banner={banner} />

      <ChipNav
        cinemas={cinemas}
        active={activeNeighborhood}
        onSelect={(name) => {
          localStorage.setItem(LS_KEY, name);
          setActiveNeighborhood(name);
        }}
      />

      <MovieList
        movies={movies}
        activeNeighborhood={activeNeighborhood}
        loading={loading}
        onShowAll={() => setActiveNeighborhood("All")}
      />

      <footer>
        <span id="last-updated">
          {fetchedAt ? `Updated ${relativeTime(fetchedAt)}` : ""}
        </span>
      </footer>
    </>
  );
}
