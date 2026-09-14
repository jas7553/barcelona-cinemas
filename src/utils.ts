import type { Listings, Theater, TransformedMovie, TransformedShowtime, CinemaViewGroup } from "./types";

// ── Barcelona wall-clock ↔ instant conversions ──────────────────────────────
//
// Showtime `date`/`time` strings are Barcelona wall-clock by data contract
// (see CLAUDE.md). Every conversion between those strings and a JS `Date`
// instant must go through `Intl.DateTimeFormat` pinned to Europe/Madrid —
// never through the engine's ambient timezone (`new Date(y, mo, d, h, mi)`,
// `.setHours()`, `.getHours()`, etc.), or a browser/device in another zone
// disagrees with the Madrid-pinned SSG render and produces wrong day buckets,
// wrong past-showtime filtering, and a hydration mismatch.

const MADRID_TZ = "Europe/Madrid";

interface MadridParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const madridPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Decompose an instant into its Europe/Madrid wall-clock components. */
export function madridParts(instant: Date): MadridParts {
  const parts = madridPartsFormatter.formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

/** "YYYY-MM-DD" for the Europe/Madrid calendar day an instant falls on. */
export function madridDateKey(instant: Date): string {
  const { y, mo, d } = madridParts(instant);
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** The Europe/Madrid UTC offset, in ms, applying to a given instant. */
function madridOffsetMsAt(instantMs: number): number {
  const p = madridParts(new Date(instantMs));
  const asIfUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asIfUtc - instantMs;
}

/**
 * Convert a Barcelona wall-clock `date`/`time` pair (as found on a `Showtime`)
 * to the instant it represents, correct across the DST transition.
 *
 * Standard guess-and-correct trick: treat the wall-clock components as if they
 * were UTC to get a first estimate, measure Madrid's actual offset at that
 * estimate, and re-derive the instant from it. A second pass re-measures at
 * the corrected instant so a guess landing just the wrong side of a DST
 * boundary still converges (the offset only ever takes one of two values, so
 * two passes always suffice).
 */
export function madridWallToInstant(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const targetAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  let instant = targetAsUtc - madridOffsetMsAt(targetAsUtc);
  instant = targetAsUtc - madridOffsetMsAt(instant);
  return new Date(instant);
}

/** UTC-midnight instant (ms) for a "YYYY-MM-DD" key — a stable value for day-diff arithmetic. */
function dateKeyToUtcMidnightMs(key: string): number {
  const [y, mo, d] = key.split("-").map(Number);
  return Date.UTC(y, mo - 1, d);
}

/** Whole-day difference between two "YYYY-MM-DD" keys (b - a). */
function dayKeyDiff(a: string, b: string): number {
  return Math.round((dateKeyToUtcMidnightMs(b) - dateKeyToUtcMidnightMs(a)) / 86400000);
}

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

// ── Subtitle badge ──────────────────────────────────────────────────────────

/** How a screening reads to an English speaker — the grouping key for badges. */
export type ViewingLang = "en-audio" | "en-subs" | "es-subs" | "ca-subs";

/**
 * `long` is used wherever a badge is hoisted to a day/cinema header and has the
 * room; `short` inside the showtime pill, where the tag shares a ~90px column
 * with the time.
 */
const VIEWING_LANG_LABELS: Record<ViewingLang, { long: string; short: string }> = {
  "en-audio": { long: "English", short: "EN" },
  "en-subs": { long: "English subs", short: "EN subs" },
  "es-subs": { long: "Spanish subs", short: "ES subs" },
  "ca-subs": { long: "Catalan subs", short: "CA subs" },
};

/**
 * Classify a screening by the (audio, subtitle) pair, for an English speaker.
 * English audio wins outright; otherwise the subtitle language decides.
 * Unknown → null (no badge shown).
 */
export function viewingLang(s: {
  audio_lang?: string | null;
  subtitle_lang?: string | null;
}): ViewingLang | null {
  if (s.audio_lang === "en") return "en-audio";
  if (s.subtitle_lang === "en") return "en-subs";
  if (s.subtitle_lang === "es") return "es-subs";
  if (s.subtitle_lang === "ca") return "ca-subs";
  return null;
}

/** Display label for a viewing language. Absent → null (render nothing). */
export function viewingLangLabel(
  lang: ViewingLang | null,
  form: "long" | "short" = "long",
): string | null {
  return lang ? VIEWING_LANG_LABELS[lang][form] : null;
}

const PREMIUM_FORMAT_LABELS: Record<string, string> = { imax: "IMAX" };

/** Display label for a premium-format slug. Unknown or absent → null (render nothing). */
export function premiumFormatLabel(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return PREMIUM_FORMAT_LABELS[slug] ?? null;
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

/** UTC stamp "YYYYMMDDTHHMMSSZ" for DTSTAMP. */
function icsUtcStamp(dt: Date): string {
  return (
    `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}` +
    `T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}${pad2(dt.getUTCSeconds())}Z`
  );
}

/**
 * Build a single-event VCALENDAR string for one screening. `date`/`time` are
 * Barcelona wall-clock (data contract); converted to instants via
 * `madridWallToInstant` and emitted as UTC `Z` stamps so the event lands at
 * the correct wall-clock time on any device regardless of its local zone
 * (a floating local stamp would have a non-Madrid device save the wrong time
 * — this is the primary CTA, so it must be right everywhere).
 * DTEND = start + runtime (falls back to a sane default when runtime is null).
 * `now` is injectable so SSR and hydration use the same instant and produce identical URLs.
 */
export function buildIcs(
  opts: {
    title: string;
    location: string;
    date: string; // YYYY-MM-DD, Barcelona wall-clock
    time: string; // HH:MM, Barcelona wall-clock
    runtimeMinutes: number | null;
  },
  now: Date = new Date(),
): string {
  const start = madridWallToInstant(opts.date, opts.time);
  const minutes = opts.runtimeMinutes && opts.runtimeMinutes > 0 ? opts.runtimeMinutes : ICS_FALLBACK_RUNTIME;
  const end = new Date(start.getTime() + minutes * 60000);
  const uid = `${icsUtcStamp(start)}-${opts.title.replace(/\s+/g, "-").toLowerCase()}@barcelona-movie-database`;

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Barcelona Movie Database//Showtime//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsUtcStamp(now)}`,
    `DTSTART:${icsUtcStamp(start)}`,
    `DTEND:${icsUtcStamp(end)}`,
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

/**
 * Generate 7-day array of chip labels for the day picker.
 * `now` is injectable so SSG render and client hydration agree on the same
 * reference instant (avoids a hydration mismatch); the client swaps to the
 * live clock after mount.
 */
/**
 * Day chips from `now`.
 *
 * `count` must cover the data's horizon: providers occasionally publish an
 * eighth day, and a chip-less day is unreachable — its showtimes render under
 * "All" but no filter can isolate them and no per-day count includes them.
 * Callers pass `dayHorizon(movies)`; the 7 default is the usual week.
 */
export function generateDays(
  now: Date = new Date(),
  count = 7,
): Array<{ label: string; fullLabel: string; offset: number }> {
  const { y, mo, d: startDay, h: hour } = madridParts(now);
  // Midnight UTC of the Madrid calendar day `now` falls on — a stable anchor
  // for adding whole days that doesn't depend on the engine's ambient zone.
  const baseUtcMs = Date.UTC(y, mo - 1, startDay);
  const result: Array<{ label: string; fullLabel: string; offset: number }> = [];

  for (let i = 0; i < Math.max(1, count); i++) {
    const dayUtc = new Date(baseUtcMs + i * 86400000);

    if (i === 0) {
      result.push({
        label: hour >= 18 ? "Tonight" : "Today",
        fullLabel: hour >= 18 ? "tonight" : "today",
        offset: 0,
      });
    } else {
      // dayUtc is a date-only UTC midnight; format in UTC so the ambient zone
      // can't roll it to the adjacent calendar day.
      const weekday = dayUtc.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
      const weekdayFull = dayUtc.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
      const day = dayUtc.getUTCDate();
      result.push({ label: `${weekday} ${day}`, fullLabel: `${weekdayFull} ${day}`, offset: i });
    }
  }

  return result;
}

/** Chip count needed to reach the furthest day present in the data (min 7). */
export function dayHorizon(movies: TransformedMovie[]): number {
  let max = 6;
  for (const m of movies) {
    for (const s of m.showtimes) if (s.dayOffset > max) max = s.dayOffset;
  }
  return max + 1;
}

// ── Search normalization ────────────────────────────────────────────────────

export function normalizeForSearch(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Returns a compact age string for the data freshness note, or null if under 1h old. */
export function formatDataAge(isoStr: string, now: Date = new Date()): string | null {
  const diffMs = now.getTime() - new Date(isoStr).getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 1) return null;
  if (diffH < 2) return "1h ago";
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} day${diffD !== 1 ? "s" : ""} ago`;
}

// ── Screening kind: one-off vs. run ─────────────────────────────────────────

export type ScreeningKind = "one-off" | "run";

/** No `now`: a pure function of `movie.showtimes` so it doesn't flicker as showtimes fall off the horizon. */
export function screeningKind(movie: TransformedMovie): ScreeningKind {
  const dates = new Set(movie.showtimes.map((s) => s.date));
  return dates.size <= 2 && movie.showtimes.length <= 3 ? "one-off" : "run";
}

/** Weekday abbreviation for a day offset, from the page's day chips (`days` prop). */
function dayAbbrev(offset: number, days: Array<{ label: string; offset: number }>): string {
  if (offset === 0) return "Today";
  const label = days.find((d) => d.offset === offset)?.label;
  return label ? label.split(" ")[0] : "";
}

/** Coverage label for an unfiltered run card — "Daily" / "Through Thu" / "From Fri" / "Tue · Thu · Sat". */
export function runCoverageLabel(
  movie: TransformedMovie,
  days: Array<{ label: string; offset: number }>,
): string {
  const showingOffsets = [...new Set(movie.showtimes.map((s) => s.dayOffset))].sort((a, b) => a - b);
  if (showingOffsets.length === 0) return "";

  const horizonOffsets = days.map((d) => d.offset);
  const horizonStart = horizonOffsets[0] ?? 0;
  const horizonEnd = horizonOffsets[horizonOffsets.length - 1] ?? 0;

  const isDaily = horizonOffsets.every((o) => showingOffsets.includes(o));
  if (isDaily) return "Daily";

  const first = showingOffsets[0];
  const last = showingOffsets[showingOffsets.length - 1];
  // Contiguous run of every horizon day from `first` through `last`: the gap
  // (if any) is only at the edges, so "Through"/"From" reads honestly.
  const contiguous = showingOffsets.length === last - first + 1;

  if (contiguous && first > horizonStart) return `From ${dayAbbrev(first, days)}`;
  if (contiguous && last < horizonEnd) return `Through ${dayAbbrev(last, days)}`;

  return showingOffsets.map((o) => dayAbbrev(o, days)).join(" · ");
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


/**
 * `now` is injectable so the SSG render and the first client (hydration) render
 * compute identical markup from the same instant. After mount the client passes
 * the live clock, which re-filters past showtimes the stale snapshot still showed.
 */
export function transformResponse(apiResponse: Listings, now: Date = new Date()): TransformedMovie[] {
  const todayKey = madridDateKey(now);

  const theaterMap: Record<string, Theater> = Object.fromEntries(
    apiResponse.theaters.map((t) => [t.id, t])
  );

  return apiResponse.movies.map((movie) => ({
    ...movie,
    runtimeLabel: movie.runtime_minutes != null ? formatRuntime(movie.runtime_minutes) : "",
    showtimes: movie.showtimes
      .filter((s) => s.theater_id in theaterMap)
      .map((s): TransformedShowtime => {
        const dayOffset = dayKeyDiff(todayKey, s.date);
        return {
          ...s,
          theater: theaterMap[s.theater_id],
          dayOffset,
        };
      })
      .filter((s) => {
        if (s.dayOffset < 0 || s.dayOffset > 13) return false;
        return madridWallToInstant(s.date, s.time) > now;
      })
      .sort((a, b) => a.dayOffset - b.dayOffset || a.time.localeCompare(b.time)),
  }))
  .filter((movie) => movie.showtimes.length > 0)
  // Source order is arbitrary; rating is on every card, so rating-desc gives
  // the list a self-explanatory order. Unrated films sink, ties alphabetical.
  // `sortMovies` re-orders from here when the visitor picks another axis.
  .sort(
    (a, b) =>
      (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title),
  );
}

// ── List ordering ───────────────────────────────────────────────────────────

/** How the list is ordered. Mirrors `?sort=` — "rating" is the default and
 * writes no parameter. */
export type SortMode = "rating" | "next";

/** Parse `?sort=`; anything unrecognised falls back to the default. */
export function parseSortMode(raw: string | null): SortMode {
  return raw === "next" ? "next" : "rating";
}

/**
 * Re-order an already-filtered list. `transformResponse` sorts by rating, which
 * answers "what is worth seeing"; "next" answers "what can I still catch",
 * which is the more useful axis once a day is picked. Sorting happens after the
 * day filter, so `selectedDay` scopes which showtime counts as "next" — a film
 * whose only Friday screening is at 22:00 must not sort on its Wednesday matinée.
 * Films with nothing left in scope sink to the end.
 */
export function sortMovies(
  movies: TransformedMovie[],
  mode: SortMode,
  selectedDay: number | null,
): TransformedMovie[] {
  if (mode !== "next") return movies;
  // showtimes are already ascending (dayOffset, then time), so the first match
  // in scope is the earliest one. null = nothing in scope; kept as a real null
  // rather than a max-value sentinel string, whose ordering would depend on the
  // runtime's collation table.
  const nextKey = (m: TransformedMovie): string | null => {
    const s = m.showtimes.find((x) => selectedDay == null || x.dayOffset === selectedDay);
    return s ? `${String(s.dayOffset).padStart(2, "0")}${s.time}` : null;
  };
  return movies.toSorted((a, b) => {
    const ka = nextKey(a);
    const kb = nextKey(b);
    if (ka !== kb) {
      if (ka == null) return 1;
      if (kb == null) return -1;
      if (ka !== kb) return ka < kb ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
}

/** Splits into the two By Film sections; one-offs sort chronologically by first showing, runs keep incoming order. */
export function splitByScreeningKind(
  movies: TransformedMovie[],
): { runs: TransformedMovie[]; oneOffs: TransformedMovie[] } {
  const runs: TransformedMovie[] = [];
  const oneOffs: TransformedMovie[] = [];
  for (const m of movies) (screeningKind(m) === "one-off" ? oneOffs : runs).push(m);

  const chronoKey = (m: TransformedMovie): string => {
    const s = m.showtimes[0];
    return s ? `${String(s.dayOffset).padStart(2, "0")}${s.time}` : "";
  };
  oneOffs.sort((a, b) => chronoKey(a).localeCompare(chronoKey(b)) || a.title.localeCompare(b.title));

  return { runs, oneOffs };
}

/**
 * Does this film match a free-text query? Covers what is actually on the card
 * (title, genres, credits) plus the venues it plays at — searching "Verdi" or
 * "Gràcia" from the cinema view used to return "Nothing showing", which read as
 * "this cinema has no English films" rather than "we don't search that".
 */
export function movieMatchesQuery(movie: TransformedMovie, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const hit = (v: string | null | undefined) =>
    v != null && normalizeForSearch(v).includes(normalizedQuery);
  return (
    hit(movie.title) ||
    movie.genres.some(hit) ||
    hit(movie.director) ||
    (movie.cast?.some(hit) ?? false) ||
    movie.showtimes.some((s) => hit(s.theater.name) || hit(s.theater.neighborhood))
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
  times: {
    key: string;
    t: string;
    date: string;
    bookingUrl?: string;
    /** Grouping key for badge hoisting; the view picks the long or short label. */
    lang: ViewingLang | null;
    formatBadge: string | null;
  }[];
};
export type CinemaRow = { theater: TransformedShowtime["theater"]; dayGroups: DayGroup[]; distKm?: number };

/** One cinema's showings on a single day (film detail, day-first layout). */
export type DayCinema = {
  theater: TransformedShowtime["theater"];
  times: DayGroup["times"];
  distKm?: number;
};

/** A day of the film's run, with every cinema showing it that day. */
export type DaySection = { offset: number; label: string; cinemas: DayCinema[] };

/**
 * Day-first showtimes for the film detail page.
 *
 * Cinema-first grouping scattered a single evening across every cinema block,
 * so "what can I see tonight?" meant scanning the whole page. Day-first keeps
 * one evening contiguous; cinemas repeat per day, which is the cheaper
 * repetition because the day is what people filter by first.
 */
export function buildDaySections(
  movie: TransformedMovie,
  selectedDay: number | null,
  coords: { lat: number; lng: number } | null,
  now: Date = new Date(),
): DaySection[] {
  const rows = buildCinemaRows(movie, selectedDay, coords, now);
  const dayLabelMap = new Map(generateDays(now, dayHorizon([movie])).map((d) => [d.offset, d.label]));
  const sections = new Map<number, DaySection>();

  for (const { theater, dayGroups, distKm } of rows) {
    for (const g of dayGroups) {
      // A day filter collapses buildCinemaRows to a single unlabelled group
      // keyed 0; recover the real offset from the selection.
      const offset = selectedDay ?? g.offset;
      const label =
        g.label ??
        dayLabelMap.get(offset) ??
        new Date(`${g.times[0]?.date}T00:00:00`).toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
        });
      const section = sections.get(offset) ?? { offset, label, cinemas: [] };
      section.cinemas.push({ theater, times: g.times, distKm });
      sections.set(offset, section);
    }
  }

  // buildCinemaRows already ordered the cinemas (distance, then name); the Map
  // preserved that per day, so only the days themselves need sorting.
  return [...sections.values()].sort((a, b) => a.offset - b.offset);
}

export function buildCinemaRows(
  movie: TransformedMovie,
  selectedDay: number | null,
  coords: { lat: number; lng: number } | null,
  now: Date = new Date(),
): CinemaRow[] {
  const showtimes =
    selectedDay != null
      ? movie.showtimes.filter((s) => s.dayOffset === selectedDay)
      : movie.showtimes;

  const dayLabelMap = new Map(generateDays(now).map((d) => [d.offset, d.label]));
  const byTheater = new Map<string, { theater: TransformedShowtime["theater"]; groups: Map<number, DayGroup> }>();

  for (const s of showtimes) {
    const entry = byTheater.get(s.theater.id) ?? { theater: s.theater, groups: new Map<number, DayGroup>() };
    const key = `${s.dayOffset}-${s.time}`;
    const time = {
      key,
      t: s.time,
      date: s.date,
      bookingUrl: s.booking_url ?? undefined,
      lang: viewingLang(s),
      formatBadge: premiumFormatLabel(s.premium_format),
    };
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
      .map((g) => ({ ...g, times: g.times.toSorted((a, b) => a.t.localeCompare(b.t)) }));
    const distKm =
      coords && theater.lat != null && theater.lng != null
        ? haversineKm(coords.lat, coords.lng, theater.lat, theater.lng)
        : undefined;
    return { theater, dayGroups, distKm };
  });

  // Total order even when only some rows have a distance: located rows sort
  // ahead of unlocated ones (a bare `distKm !== undefined` compare is
  // intransitive on mixed input). Ties, and the all-unlocated case, fall to name.
  return rows.sort((a, b) => {
    if (a.distKm !== undefined && b.distKm !== undefined) {
      return a.distKm - b.distKm || a.theater.name.localeCompare(b.theater.name);
    }
    if (a.distKm !== undefined) return -1;
    if (b.distKm !== undefined) return 1;
    return a.theater.name.localeCompare(b.theater.name);
  });
}

// ── Cinema group builder ────────────────────────────────────────────────────

/**
 * Group films by theater, with each film's times split per day.
 *
 * The split is the point: without a day filter this view used to dedupe times
 * across the whole week into one undated row, so "16:00 18:00 20:00" read as
 * one evening's schedule when it was really the union of five. Days stay
 * separate and labelled; a day filter yields the single unlabelled group the
 * flat layout expects. Sorted by distance if coords provided.
 */
export function buildCinemaGroups(
  movies: TransformedMovie[],
  dayOffset: number | null,
  coords: { lat: number; lng: number } | null,
): CinemaViewGroup[] {
  const theaterMap = new Map<
    string,
    { theater: TransformedShowtime["theater"]; films: CinemaViewGroup["films"] }
  >();

  for (const movie of movies) {
    const dayShowtimes = dayOffset == null
      ? movie.showtimes
      : movie.showtimes.filter((s) => s.dayOffset === dayOffset);
    const byTheater = new Map<
      string,
      { theater: TransformedShowtime["theater"]; days: Map<number, string[]> }
    >();

    for (const s of dayShowtimes) {
      const entry = byTheater.get(s.theater.id) ?? {
        theater: s.theater,
        days: new Map<number, string[]>(),
      };
      const key = dayOffset == null ? s.dayOffset : -1;
      const times = entry.days.get(key) ?? [];
      if (!times.includes(s.time)) times.push(s.time);
      entry.days.set(key, times);
      byTheater.set(s.theater.id, entry);
    }

    for (const [theaterId, { theater, days }] of byTheater) {
      const existing = theaterMap.get(theaterId) ?? { theater, films: [] };
      existing.films.push({
        movie,
        days: [...days.entries()]
          .sort(([a], [b]) => a - b)
          .map(([offset, times]) => ({ offset, times: times.toSorted() })),
      });
      theaterMap.set(theaterId, existing);
    }
  }

  const groups: CinemaViewGroup[] = [...theaterMap.entries()].map(([id, { theater, films }]) => ({
    theaterId: id,
    theater,
    films,
    distanceKm:
      coords && theater.lat != null && theater.lng != null
        ? haversineKm(coords.lat, coords.lng, theater.lat, theater.lng)
        : undefined,
  }));

  // Total order even when only some groups have a distance (see buildCinemaRows):
  // located groups sort ahead of unlocated, ties and all-unlocated fall to name.
  return groups.sort((a, b) => {
    if (a.distanceKm !== undefined && b.distanceKm !== undefined) {
      return a.distanceKm - b.distanceKm || a.theater.name.localeCompare(b.theater.name);
    }
    if (a.distanceKm !== undefined) return -1;
    if (b.distanceKm !== undefined) return 1;
    return a.theater.name.localeCompare(b.theater.name);
  });
}

