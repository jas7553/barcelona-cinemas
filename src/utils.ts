import type { Listings, Theater, TransformedMovie, TransformedShowtime, CinemaViewGroup } from "./types";

// ── Geo distance ────────────────────────────────────────────────────────────

/** Haversine formula — returns distance in kilometres. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistKm(km: number | null | undefined): string | null {
  if (km == null) return null;
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

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

/** Generate 7-day array of chip labels for the day picker. */
export function generateDays(): Array<{ label: string; fullLabel: string; offset: number }> {
  const hour = new Date().getHours();
  const result: Array<{ label: string; fullLabel: string; offset: number }> = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);

    if (i === 0) {
      result.push({
        label: hour >= 18 ? "Tonight" : "Today",
        fullLabel: hour >= 18 ? "tonight" : "today",
        offset: 0,
      });
    } else {
      const weekday = d.toLocaleDateString("en-GB", { weekday: "short" });
      const weekdayFull = d.toLocaleDateString("en-GB", { weekday: "long" });
      const day = d.getDate();
      result.push({ label: `${weekday} ${day}`, fullLabel: `${weekdayFull} ${day}`, offset: i });
    }
  }

  return result;
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

/** Returns a compact age string for the data freshness note, or null if under 1h old. */
export function formatDataAge(isoStr: string): string | null {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 1) return null;
  if (diffH < 2) return "1h ago";
  return `${Math.floor(diffH)}h ago`;
}

// ── Last-chance detection ───────────────────────────────────────────────────

/**
 * A film is "last chance" when it has only 1 unique cinema showing it
 * OR 3 or fewer total remaining showtimes.
 */
export function isLastChance(movie: TransformedMovie): boolean {
  const theaters = new Set(movie.showtimes.map((s) => s.theater.id));
  return theaters.size <= 1 || movie.showtimes.length <= 3;
}

// ── Client-side API response transform ─────────────────────────────────────

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
            lat: null,
            lng: null,
          },
          dayOffset,
        };
      })
      .filter((s) => {
        if (s.dayOffset < 0 || s.dayOffset > 13) return false;
        const [sy, smo, sd] = s.date.split("-").map(Number);
        const [sh, sm] = s.time.split(":").map(Number);
        return new Date(sy, smo - 1, sd, sh, sm) > new Date();
      })
      .sort((a, b) => a.dayOffset - b.dayOffset || a.time.localeCompare(b.time)),
  }))
  .filter((movie) => movie.showtimes.length > 0);
}

// ── Cinema group builder ────────────────────────────────────────────────────

/** Group films by theater for the selected day. Sorted by distance if coords provided. */
export function buildCinemaGroups(
  movies: TransformedMovie[],
  dayOffset: number,
  coords: { lat: number; lng: number } | null,
): CinemaViewGroup[] {
  const theaterMap = new Map<
    string,
    { theaterName: string; lat: number | null; lng: number | null; mapsUrl: string; films: CinemaViewGroup["films"] }
  >();

  for (const movie of movies) {
    const dayShowtimes = movie.showtimes.filter((s) => s.dayOffset === dayOffset);
    const byTheater = new Map<string, { theater: TransformedShowtime["theater"]; times: string[] }>();

    for (const s of dayShowtimes) {
      const entry = byTheater.get(s.theater.id) ?? { theater: s.theater, times: [] };
      if (!entry.times.includes(s.time)) entry.times.push(s.time);
      byTheater.set(s.theater.id, entry);
    }

    for (const [theaterId, { theater, times }] of byTheater) {
      const existing = theaterMap.get(theaterId) ?? {
        theaterName: theater.name,
        lat: theater.lat ?? null,
        lng: theater.lng ?? null,
        mapsUrl: theater.maps_url,
        films: [],
      };
      existing.films.push({ movie, times: [...times].sort() });
      theaterMap.set(theaterId, existing);
    }
  }

  const groups: CinemaViewGroup[] = [...theaterMap.entries()].map(([id, g]) => ({
    theaterId: id,
    ...g,
    distanceKm:
      coords && g.lat != null && g.lng != null
        ? haversineKm(coords.lat, coords.lng, g.lat, g.lng)
        : undefined,
  }));

  return groups.sort((a, b) => {
    if (a.distanceKm !== undefined && b.distanceKm !== undefined) {
      return a.distanceKm - b.distanceKm;
    }
    return a.theaterName.localeCompare(b.theaterName);
  });
}

// ── Smart sort ──────────────────────────────────────────────────────────────

/**
 * Sort films into priority tiers:
 *   0 = last chance (1 remaining screening) — only when groupLastChance is true
 *   1 = highly rated (TMDb ≥ 7.5)
 *   2 = widely screened (above-median screening count)
 *   3 = everything else
 * Within each tier, sort by rating descending.
 * Films in hiddenIds are excluded entirely.
 */
export function smartSort(
  movies: TransformedMovie[],
  hiddenIds: Set<string>,
  groupLastChance = false,
): TransformedMovie[] {
  const visible = movies.filter((m) => !hiddenIds.has(m.id));

  const counts = visible.map((m) => m.showtimes.length).sort((a, b) => a - b);
  const median = counts.length === 0 ? 0 : counts[Math.floor(counts.length / 2)];

  const tier = (m: TransformedMovie): number => {
    if (groupLastChance && m.showtimes.every((s) => s.dayOffset <= 1)) return 0;
    if ((m.rating ?? 0) >= 7.5) return 1;
    if (m.showtimes.length > median) return 2;
    return 3;
  };

  return [...visible].sort((a, b) => {
    const diff = tier(a) - tier(b);
    if (diff !== 0) return diff;
    return (b.rating ?? 0) - (a.rating ?? 0);
  });
}
