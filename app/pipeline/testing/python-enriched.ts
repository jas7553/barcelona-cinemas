/**
 * Test only: the legacy Python `Movie` dicts of the reconcile and TMDb goldens, to and from
 * `EnrichedFilm`. Both sides are compared in one canonical form, which differs from Python's in
 * three ways, each because the field has no TypeScript counterpart:
 *
 * - `null` and absent are the same: Python writes unknown fields either way, TypeScript omits them.
 * - Showtimes lose `neighborhood` and `address`: TypeScript reads them from the registry when it
 *   publishes, not per showing.
 * - A showtime without `language` reads as `"vo"`, as Python's reconcile reads it: every
 *   TypeScript showing is original version. A `"dub"` showtime can't be represented and throws.
 */
import { z } from "zod";
import { showingStart } from "../normalize.ts";
import type { EnrichedFilm, PreviousEnrichment } from "../tmdb.ts";
import { PREMIUM_FORMATS, type ScrapedFilm, type ScrapedShowing } from "../types.ts";

/** An object schema reading a `null` value as an absent key. */
function nullsAbsent<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (raw) =>
      typeof raw === "object" && raw !== null
        ? Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null))
        : raw,
    schema,
  );
}

const PythonShowtime = nullsAbsent(
  z.strictObject({
    cinema: z.string(),
    neighborhood: z.string(),
    address: z.string(),
    date: z.string(),
    time: z.string(),
    language: z.enum(["vo", "dub"]).exactOptional(),
    audio_lang: z.enum(["en", "other"]).exactOptional(),
    subtitle_lang: z.enum(["en", "es", "ca"]).exactOptional(),
    booking_url: z.string().exactOptional(),
    premium_format: z.enum(PREMIUM_FORMATS).exactOptional(),
  }),
);
type PythonShowtime = z.infer<typeof PythonShowtime>;

const PythonMovie = nullsAbsent(
  z.strictObject({
    title: z.string(),
    tmdb_id: z.int().exactOptional(),
    imdb_id: z.string().exactOptional(),
    year: z.int().exactOptional(),
    poster_url: z.string().exactOptional(),
    backdrop_url: z.string().exactOptional(),
    trailer_url: z.string().exactOptional(),
    tagline: z.string().exactOptional(),
    synopsis: z.string().exactOptional(),
    rating: z.number().exactOptional(),
    vote_count: z.int().exactOptional(),
    runtime_mins: z.int().exactOptional(),
    genres: z.array(z.string()).exactOptional(),
    english_title: z.string().exactOptional(),
    original_lang: z.string().exactOptional(),
    director: z.string().exactOptional(),
    cast: z.array(z.string()).exactOptional(),
    enriched_at: z.string().exactOptional(),
    tmdb_match_version: z.int().exactOptional(),
    showtimes: z.array(PythonShowtime),
  }),
);

function showingFromPython(showtime: PythonShowtime): ScrapedShowing {
  const { cinema, date, time, language } = showtime;
  if (language === "dub") throw new Error(`a dubbed showing can't be a ScrapedShowing: ${date}`);
  const startsAt = showingStart(date, time);
  if (startsAt === undefined) throw new Error(`not a Madrid wall-clock time: ${date} ${time}`);
  const { audio_lang, subtitle_lang, booking_url, premium_format } = showtime;
  return {
    cinema,
    starts_at: startsAt,
    language: "vo",
    ...(audio_lang && { audio_lang }),
    ...(subtitle_lang && { subtitle_lang }),
    ...(booking_url !== undefined && { booking_url }),
    ...(premium_format && { premium_format }),
  };
}

/** A Python `Movie` as the film it stands for, enrichment fields and all. */
export function filmFromPython(raw: unknown): EnrichedFilm {
  const { showtimes, ...fields } = PythonMovie.parse(raw);
  return { ...fields, showings: showtimes.map(showingFromPython) };
}

/** A previous refresh's Python `Movie` as an earlier enrichment, which ignores its showings. */
export function previousFromPython(raw: unknown): PreviousEnrichment {
  return filmFromPython(raw);
}

/** A Python `Movie` as a provider's film; throws if it carries enrichment. */
export function scrapedFromPython(raw: unknown): ScrapedFilm {
  const { title, imdb_id, year, showings, ...rest } = filmFromPython(raw);
  if (Object.keys(rest).length > 0) {
    throw new Error(`${title} is not a provider's film: ${Object.keys(rest).join(", ")}`);
  }
  return {
    title,
    ...(imdb_id !== undefined && { imdb_id }),
    ...(year !== undefined && { year }),
    showings,
  };
}

/** A `Date.toISOString()` instant as Python's `datetime.isoformat()` writes it in UTC. */
function pythonIso(value: string): string {
  const match = /^(.{19})\.(\d{3})Z$/.exec(value);
  if (!match) return value;
  const [, seconds = "", millis = ""] = match;
  return `${seconds}${millis === "000" ? "" : `.${millis}000`}+00:00`;
}

/** A film in the canonical Python form. Source labels have no Python counterpart. */
export function toCanonicalPython(film: EnrichedFilm): Record<string, unknown> {
  const { showings, enriched_at, ...fields } = film;
  return {
    ...fields,
    ...(enriched_at !== undefined && { enriched_at: pythonIso(enriched_at) }),
    showtimes: showings.map((showing) => {
      const { cinema, starts_at, language, audio_lang, subtitle_lang } = showing;
      const { booking_url, premium_format } = showing;
      return {
        cinema,
        date: starts_at.slice(0, 10),
        time: starts_at.slice(11, 16),
        language,
        ...(audio_lang !== undefined && { audio_lang }),
        ...(subtitle_lang !== undefined && { subtitle_lang }),
        ...(booking_url !== undefined && { booking_url }),
        ...(premium_format !== undefined && { premium_format }),
      };
    }),
  };
}

/** A golden's Python `Movie` in the canonical form. */
export function canonicalPython(raw: unknown): Record<string, unknown> {
  const { showtimes, ...fields } = PythonMovie.parse(raw);
  return {
    ...fields,
    showtimes: showtimes.map((showtime) => {
      const { cinema, date, time, language = "vo" } = showtime;
      const { audio_lang, subtitle_lang, booking_url, premium_format } = showtime;
      return {
        cinema,
        date,
        time,
        language,
        ...(audio_lang !== undefined && { audio_lang }),
        ...(subtitle_lang !== undefined && { subtitle_lang }),
        ...(booking_url !== undefined && { booking_url }),
        ...(premium_format !== undefined && { premium_format }),
      };
    }),
  };
}
