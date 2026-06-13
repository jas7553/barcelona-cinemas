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

// ── Language display ────────────────────────────────────────────────────────

/** Map an ISO 639-1 code (e.g. "fr") to an English language name ("French"). */
export function formatLanguage(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    // DisplayNames echoes the input back for codes it doesn't recognise.
    if (!name || name.toLowerCase() === code.toLowerCase()) return null;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return null;
  }
}

// ── Calendar (.ics) generation ──────────────────────────────────────────────

/** Default event length when a film's runtime is unknown. */
const ICS_FALLBACK_RUNTIME = 120;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Escape a value for an iCalendar TEXT field (RFC 5545 §3.3.11). */
function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Floating local datetime stamp "YYYYMMDDTHHMMSS" — calendar reads it in the device's zone. */
function icsLocalStamp(dt: Date): string {
  return (
    `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}` +
    `T${pad2(dt.getHours())}${pad2(dt.getMinutes())}${pad2(dt.getSeconds())}`
  );
}

/** UTC stamp "YYYYMMDDTHHMMSSZ" for DTSTAMP. */
function icsUtcStamp(dt: Date): string {
  return (
    `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}` +
    `T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}${pad2(dt.getUTCSeconds())}Z`
  );
}

/**
 * Build a single-event VCALENDAR string for one screening. Times are emitted as
 * floating local time so the user's device interprets them in Barcelona's zone.
 * DTEND = start + runtime (falls back to a sane default when runtime is null).
 */
export function buildIcs(opts: {
  title: string;
  location: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  runtimeMinutes: number | null;
}): string {
  const [y, mo, d] = opts.date.split("-").map(Number);
  const [h, mi] = opts.time.split(":").map(Number);
  const start = new Date(y, mo - 1, d, h, mi, 0);
  const minutes = opts.runtimeMinutes && opts.runtimeMinutes > 0 ? opts.runtimeMinutes : ICS_FALLBACK_RUNTIME;
  const end = new Date(start.getTime() + minutes * 60000);
  const uid = `${icsLocalStamp(start)}-${opts.title.replace(/\s+/g, "-").toLowerCase()}@barcelona-movie-database`;

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Barcelona Movie Database//Showtime//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsUtcStamp(new Date())}`,
    `DTSTART:${icsLocalStamp(start)}`,
    `DTEND:${icsLocalStamp(end)}`,
    `SUMMARY:${escapeIcsText(opts.title)}`,
    `LOCATION:${escapeIcsText(opts.location)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** Build a data-URI href for an .ics string — opens cleanly in Apple Calendar on iOS Safari. */
export function icsHref(ics: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
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
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} day${diffD !== 1 ? "s" : ""} ago`;
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

/**
 * The API serves posters at w342, sized for the detail view. Card thumbnails
 * render at 36-72px CSS width, so w185 covers them even at 3× DPR. TMDb
 * encodes size as a path segment, so a swap is enough.
 */
export function thumbPosterUrl(posterUrl: string | null): string | null {
  return posterUrl ? posterUrl.replace("/w342/", "/w185/") : null;
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
      .filter((s) => s.theater_id in theaterMap)
      .map((s): TransformedShowtime => {
        const showDate = new Date(`${s.date}T00:00:00`);
        const dayOffset = Math.round((showDate.getTime() - today.getTime()) / 86400000);
        return {
          ...s,
          theater: theaterMap[s.theater_id],
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
  .filter((movie) => movie.showtimes.length > 0)
  // Source order is arbitrary; rating is on every card, so rating-desc gives
  // the list a self-explanatory order. Unrated films sink, ties alphabetical.
  .sort(
    (a, b) =>
      (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title),
  );
}

// ── Movie metadata formatting ───────────────────────────────────────────────

export function formatMovieMeta(movie: TransformedMovie, includeRuntime = false): string {
  const genre = movie.genres.slice(0, 2).join(" · ");
  return [genre, movie.year?.toString(), includeRuntime ? movie.runtimeLabel : undefined]
    .filter(Boolean)
    .join(" · ");
}

// ── Cinema row builder (film detail view) ───────────────────────────────────

export type DayGroup = {
  label: string | null;
  offset: number;
  times: { key: string; t: string; date: string; bookingUrl?: string }[];
};
export type CinemaRow = { theater: TransformedShowtime["theater"]; dayGroups: DayGroup[]; distKm?: number };

export function buildCinemaRows(
  movie: TransformedMovie,
  selectedDay: number | null,
  coords: { lat: number; lng: number } | null,
): CinemaRow[] {
  const showtimes =
    selectedDay != null
      ? movie.showtimes.filter((s) => s.dayOffset === selectedDay)
      : movie.showtimes;

  const dayLabelMap = new Map(generateDays().map((d) => [d.offset, d.label]));
  const byTheater = new Map<string, { theater: TransformedShowtime["theater"]; groups: Map<number, DayGroup> }>();

  for (const s of showtimes) {
    const entry = byTheater.get(s.theater.id) ?? { theater: s.theater, groups: new Map<number, DayGroup>() };
    const key = `${s.dayOffset}-${s.time}`;
    const time = { key, t: s.time, date: s.date, bookingUrl: s.booking_url ?? undefined };
    if (selectedDay != null) {
      const group = entry.groups.get(0) ?? { label: null, offset: 0, times: [] };
      if (!group.times.some((x) => x.key === key)) group.times.push(time);
      entry.groups.set(0, group);
    } else {
      const label =
        dayLabelMap.get(s.dayOffset) ??
        new Date(`${s.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
      const group = entry.groups.get(s.dayOffset) ?? { label, offset: s.dayOffset, times: [] };
      if (!group.times.some((x) => x.key === key)) group.times.push(time);
      entry.groups.set(s.dayOffset, group);
    }
    byTheater.set(s.theater.id, entry);
  }

  const rows = [...byTheater.values()].map(({ theater, groups }) => {
    const dayGroups: DayGroup[] = [...groups.values()]
      .sort((a, b) => a.offset - b.offset)
      .map((g) => ({ ...g, times: [...g.times].sort((a, b) => a.t.localeCompare(b.t)) }));
    const distKm =
      coords && theater.lat != null && theater.lng != null
        ? haversineKm(coords.lat, coords.lng, theater.lat, theater.lng)
        : undefined;
    return { theater, dayGroups, distKm };
  });

  return rows.sort((a, b) => {
    if (a.distKm !== undefined && b.distKm !== undefined) return a.distKm - b.distKm;
    return a.theater.name.localeCompare(b.theater.name);
  });
}

// ── Cinema group builder ────────────────────────────────────────────────────

/** Group films by theater for the selected day. Sorted by distance if coords provided. */
export function buildCinemaGroups(
  movies: TransformedMovie[],
  dayOffset: number | null,
  coords: { lat: number; lng: number } | null,
): CinemaViewGroup[] {
  const theaterMap = new Map<
    string,
    {
      theaterName: string;
      theater: TransformedShowtime["theater"];
      lat: number | null;
      lng: number | null;
      mapsUrl: string;
      films: CinemaViewGroup["films"];
    }
  >();

  for (const movie of movies) {
    const dayShowtimes = dayOffset == null
      ? movie.showtimes
      : movie.showtimes.filter((s) => s.dayOffset === dayOffset);
    const byTheater = new Map<string, { theater: TransformedShowtime["theater"]; times: string[] }>();

    for (const s of dayShowtimes) {
      const entry = byTheater.get(s.theater.id) ?? { theater: s.theater, times: [] };
      if (!entry.times.includes(s.time)) entry.times.push(s.time);
      byTheater.set(s.theater.id, entry);
    }

    for (const [theaterId, { theater, times }] of byTheater) {
      const existing = theaterMap.get(theaterId) ?? {
        theaterName: theater.name,
        theater,
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
