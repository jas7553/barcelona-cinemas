import type { FilmDiscovery, Listings, Theater, TransformedMovie, TransformedShowtime } from "./types";

// ── Runtime formatting ──────────────────────────────────────────────────────

export function formatRuntime(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ── Date helpers ────────────────────────────────────────────────────────────

/**
 * Format a day offset (0–6) as a display string.
 * date is the Date object for that offset day.
 * Returns: "Today" | "Tomorrow" | "Mon 28 Mar"
 */
export function formatDayLabel(offset: number, date: Date): string {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** Short sub-label for days beyond Tomorrow: "28 Mar" */
export function formatDaySubLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ── Search normalization ────────────────────────────────────────────────────

export function normalizeForSearch(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// ── Relative time ───────────────────────────────────────────────────────────

export function relativeTime(isoStr: string): string {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  const diffHrs = Math.round(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs} hour${diffHrs !== 1 ? "s" : ""} ago`;
  const diffDays = Math.round(diffHrs / 24);
  return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
}

// ── Client-side API response transform (HANDOFF.md §9) ──────────────────────

export function todayAtMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function transformResponse(apiResponse: Listings): TransformedMovie[] {
  const today = todayAtMidnight();

  const theaterMap: Record<string, Theater> = Object.fromEntries(
    apiResponse.theaters.map((t) => [t.id, t])
  );

  return apiResponse.movies.map((movie) => ({
    ...movie,
    runtimeLabel: movie.runtime_minutes != null ? formatRuntime(movie.runtime_minutes) : "",
    showtimes: movie.showtimes
      .map((s): TransformedShowtime => {
        const showDate = new Date(`${s.date}T00:00:00`);
        const dayOffset = Math.round((showDate.getTime() - today.getTime()) / 86400000);
        return {
          ...s,
          theater: theaterMap[s.theater_id] ?? {
            id: s.theater_id,
            name: s.theater_id,
            neighborhood: "",
            website_url: "",
            maps_url: "",
          },
          dayOffset,
        };
      })
      .filter((s) => s.dayOffset >= 0 && s.dayOffset <= 6)
      .sort((a, b) => a.dayOffset - b.dayOffset || a.time.localeCompare(b.time)),
  }));
}

// ── Discover helpers ────────────────────────────────────────────────────────

/**
 * Returns "Today" | "Tomorrow" | short weekday (e.g. "Mon")
 */
export function formatDayShort(offset: number, date: Date): string {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return date.toLocaleDateString("en-GB", { weekday: "short" });
}

/**
 * Derives FilmDiscovery fields for each TransformedMovie.
 */
export function computeFilmDiscovery(movies: TransformedMovie[], now?: Date): FilmDiscovery[] {
  const base = now ?? new Date();
  const today = new Date(base);
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();
  const cutoff = base.getTime() + 48 * 60 * 60 * 1000;

  return movies.map((m) => {
    const theaterIds = new Set(m.showtimes.map((s) => s.theater.id));
    const theaterCount = theaterIds.size;
    const screeningCount = m.showtimes.length;
    const isNewRelease = m.year === currentYear;
    const isLimitedRun = screeningCount <= 3;

    const lastShowtime = m.showtimes
      .map((s) => new Date(`${s.date}T${s.time}`).getTime())
      .reduce((max, t) => Math.max(max, t), 0);
    const isLastChance = lastShowtime > 0 && lastShowtime <= cutoff;

    const offsetMap = new Map<number, Date>();
    for (const s of m.showtimes) {
      if (!offsetMap.has(s.dayOffset)) {
        offsetMap.set(s.dayOffset, new Date(`${s.date}T00:00:00`));
      }
    }
    const availableDays = [...offsetMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([offset, date]) => formatDayShort(offset, date));

    return { ...m, theaterCount, screeningCount, isNewRelease, isLimitedRun, isLastChance, availableDays };
  });
}
