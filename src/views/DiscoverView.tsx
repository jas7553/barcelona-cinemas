import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SharedProps } from "../App";
import type { DiscoverSortBy, FilmDiscovery } from "../types";
import { normalizeForSearch, relativeTime } from "../utils";
import FilmCard from "../components/FilmCard";
import Footer from "../components/Footer";
import GenreBar from "../components/GenreBar";
import Header from "../components/Header";
import SectionHeader from "../components/SectionHeader";
import SortControl from "../components/SortControl";

const DISCOVER_SORT_OPTIONS = [
  { value: "rating", label: "Rating" },
  { value: "title", label: "Title A–Z" },
  { value: "screenings", label: "Most screenings" },
];

const SKELETON_COUNT = 12;

function DiscoverSkeleton() {
  return (
    <div className="discover-skeleton-grid" aria-hidden="true">
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <div key={i} className="discover-skeleton-card skeleton-block">
          <div className="discover-skeleton-poster skeleton-block" />
          <div className="discover-skeleton-body">
            <div className="discover-skeleton-line skeleton-block" style={{ width: "80%" }} />
            <div className="discover-skeleton-line skeleton-block" style={{ width: "50%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DiscoverView({
  filmDiscovery,
  genres,
  generatedAt,
  stale,
  loading,
  error,
  onRetry,
}: SharedProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedGenre = searchParams.get("genre") ?? "all";
  const sortBy = (searchParams.get("sort") as DiscoverSortBy) ?? "rating";
  const [searchQuery, setSearchQuery] = useState("");

  const setGenre = (g: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (g === "all") next.delete("genre");
      else next.set("genre", g);
      return next;
    });
  };

  const setSort = (s: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (s === "rating") next.delete("sort");
      else next.set("sort", s);
      return next;
    });
  };

  const isFiltered = selectedGenre !== "all" || searchQuery.trim() !== "";

  const filteredFilms = useMemo(() => {
    const q = normalizeForSearch(searchQuery);
    let films = filmDiscovery;

    if (selectedGenre !== "all") {
      films = films.filter((f) => f.genres.includes(selectedGenre));
    }
    if (q) {
      films = films.filter((f) => normalizeForSearch(f.title).includes(q));
    }

    const sorted = [...films];
    if (sortBy === "rating") {
      sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    } else if (sortBy === "title") {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "screenings") {
      sorted.sort((a: FilmDiscovery, b: FilmDiscovery) => b.screeningCount - a.screeningCount);
    }
    return sorted;
  }, [filmDiscovery, selectedGenre, searchQuery, sortBy]);

  const { highlights, dontMiss, nowPlaying } = useMemo(() => {
    if (isFiltered) return { highlights: [], dontMiss: [], nowPlaying: [] };

    const byRating = [...filteredFilms].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    const highlightSet = new Set(byRating.slice(0, 3).map((f) => f.id));

    const h = byRating.slice(0, 3);
    const dm = filteredFilms.filter(
      (f) => !highlightSet.has(f.id) && (f.isLimitedRun || f.isLastChance)
    );
    const np = filteredFilms.filter(
      (f) => !highlightSet.has(f.id) && !f.isLimitedRun && !f.isLastChance
    );
    return { highlights: h, dontMiss: dm, nowPlaying: np };
  }, [filteredFilms, isFiltered]);

  const [renderedAt] = useState(() => Date.now());
  const generatedTimestamp = generatedAt == null ? Number.NaN : Date.parse(generatedAt);
  const showStaleNotice =
    stale ||
    (Number.isFinite(generatedTimestamp) &&
      renderedAt - generatedTimestamp > 24 * 60 * 60 * 1000);

  return (
    <>
      <a className="skip-link" href="#discover-content">Skip to films</a>

      <Header
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        filmCount={isFiltered ? filteredFilms.length : filmDiscovery.length}
        filterPanelOpen={false}
        onToggleFilter={() => undefined}
        activeFilterCount={0}
        activeView="films"
      />

      <GenreBar genres={genres} selectedGenre={selectedGenre} onSelect={setGenre} />

      <main id="discover-content" aria-label="Film discovery">
        {loading ? (
          <div className="discover-layout">
            <DiscoverSkeleton />
          </div>
        ) : error ? (
          <div className="discover-layout">
            <div className="discover-empty">
              <div className="discover-empty-icon">⚠️</div>
              <p className="discover-empty-title">Couldn't load films</p>
              <p className="discover-empty-sub">Try refreshing.</p>
              <button className="retry-btn" onClick={onRetry} style={{ marginTop: 14 }}>Retry</button>
            </div>
          </div>
        ) : (
          <div className="discover-layout">
            {showStaleNotice && generatedAt && (
              <div className="list-footer-meta is-stale" style={{ marginBottom: 16 }}>
                Listings last updated {relativeTime(generatedAt)}
              </div>
            )}

            <div className="discover-sort-row">
              <SortControl value={sortBy} onChange={setSort} options={DISCOVER_SORT_OPTIONS} />
            </div>

            {isFiltered ? (
              filteredFilms.length === 0 ? (
                <div className="discover-empty">
                  <div className="discover-empty-icon">🔍</div>
                  <p className="discover-empty-title">No films match your filters</p>
                  <p className="discover-empty-sub">Try a different genre or search term</p>
                </div>
              ) : (
                <div className="discover-section">
                  <div className="discover-grid">
                    {filteredFilms.map((f) => (
                      <FilmCard key={f.id} film={f} />
                    ))}
                  </div>
                </div>
              )
            ) : (
              <>
                {highlights.length > 0 && (
                  <div className="discover-section">
                    <SectionHeader title="Highlights" subtitle="Top-rated films this week" />
                    <div className="discover-grid">
                      {highlights.map((f) => (
                        <FilmCard key={f.id} film={f} />
                      ))}
                    </div>
                  </div>
                )}
                {dontMiss.length > 0 && (
                  <div className="discover-section">
                    <SectionHeader title="Don't miss" subtitle="Limited runs and last chances" />
                    <div className="discover-grid">
                      {dontMiss.map((f) => (
                        <FilmCard key={f.id} film={f} />
                      ))}
                    </div>
                  </div>
                )}
                {nowPlaying.length > 0 && (
                  <div className="discover-section">
                    <SectionHeader title="Now playing" count={nowPlaying.length} />
                    <div className="discover-grid">
                      {nowPlaying.map((f) => (
                        <FilmCard key={f.id} film={f} />
                      ))}
                    </div>
                  </div>
                )}
                {filmDiscovery.length === 0 && (
                  <div className="discover-empty">
                    <div className="discover-empty-icon">🎬</div>
                    <p className="discover-empty-title">No films listed right now</p>
                    <p className="discover-empty-sub">Check back soon</p>
                  </div>
                )}
              </>
            )}

            {generatedAt && !showStaleNotice && (
              <div className="list-footer-meta">
                Listings last updated {relativeTime(generatedAt)}
              </div>
            )}
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}
