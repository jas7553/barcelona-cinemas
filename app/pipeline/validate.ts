/**
 * The check a provider's films pass before reconciliation. A field that isn't what the rest of the
 * pipeline reads is dropped from its film or showing; a showing without a cinema or a valid start,
 * and a film without a title, are dropped whole. A film left with no showings stays.
 */
import { z } from "zod";
import { isCalendarDay } from "../shared/madrid.ts";
import type { Logger } from "./log.ts";
import { PREMIUM_FORMATS, type ScrapedFilm, type ScrapedShowing } from "./types.ts";

const text = z.string().trim().min(1);

const StartsAt = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d[+-]\d{2}:\d{2}$/, {
    error: "not a start time",
  })
  .refine((value) => isCalendarDay(value.slice(0, 10)), { error: "not a calendar day" });

const ImdbId = z
  .string()
  .trim()
  .regex(/^tt\d+$/, { error: "not an IMDb title id" });
const Year = z.int().positive();
const AudioLang = z
  .string()
  .trim()
  .pipe(z.enum(["en", "other"]));
const SubtitleLang = z
  .string()
  .trim()
  .pipe(z.enum(["en", "es", "ca"]));
const PremiumFormat = z.string().trim().pipe(z.enum(PREMIUM_FORMATS));
const BookingUrl = z
  .string()
  .trim()
  .refine((url) => /^https?:\/\//.test(url), { error: "not an http(s) URL" })
  // Dropped so a duplicate showing's real link wins the merge.
  .refine((url) => !url.includes("%s"), { error: "unfilled %s placeholder" });
const Labels = z.object({
  version: z.string().exactOptional(),
  audio: z.string().exactOptional(),
  subtitles: z.string().exactOptional(),
  format: z.string().exactOptional(),
});

const Film = z.looseObject({ title: text, showings: z.array(z.unknown()) });
const Showing = z.looseObject({ cinema: text, starts_at: StartsAt });

/** Counts what was dropped, by `"<field>: <reason>"`. */
type Discards = Map<string, number>;

function discard(discards: Discards, field: string, error: z.ZodError): void {
  const key = `${field}: ${error.issues[0]?.message ?? "invalid"}`;
  discards.set(key, (discards.get(key) ?? 0) + 1);
}

/**
 * Reads `raw`'s optional fields: absent, `null` and blank strings are unset, and a value `schema`
 * rejects is dropped and counted.
 */
function optionalFields(raw: Readonly<Record<string, unknown>>, discards: Discards) {
  return <T>(field: string, schema: z.ZodType<T>): T | undefined => {
    const value = raw[field];
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string" && value.trim() === "") return undefined;
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    discard(discards, field, parsed.error);
    return undefined;
  };
}

function validShowing(raw: unknown, discards: Discards): ScrapedShowing | undefined {
  const showing = Showing.safeParse(raw);
  if (!showing.success) {
    discard(discards, "showing", showing.error);
    return undefined;
  }
  const { cinema, starts_at } = showing.data;
  const field = optionalFields(showing.data, discards);
  const audio_lang = field("audio_lang", AudioLang);
  const subtitle_lang = field("subtitle_lang", SubtitleLang);
  const premium_format = field("premium_format", PremiumFormat);
  const booking_url = field("booking_url", BookingUrl);
  const labels = field("labels", Labels);
  return {
    cinema,
    starts_at,
    language: "vo",
    ...(audio_lang !== undefined && { audio_lang }),
    ...(subtitle_lang !== undefined && { subtitle_lang }),
    ...(premium_format !== undefined && { premium_format }),
    ...(booking_url !== undefined && { booking_url }),
    ...(labels !== undefined && { labels }),
  };
}

function validFilm(raw: unknown, discards: Discards): ScrapedFilm | undefined {
  const film = Film.safeParse(raw);
  if (!film.success) {
    discard(discards, "film", film.error);
    return undefined;
  }
  const { title, showings } = film.data;
  const field = optionalFields(film.data, discards);
  const imdb_id = field("imdb_id", ImdbId);
  const year = field("year", Year);
  return {
    title,
    ...(imdb_id !== undefined && { imdb_id }),
    ...(year !== undefined && { year }),
    showings: showings.flatMap((showing) => validShowing(showing, discards) ?? []),
  };
}

/** `films` as the rest of the pipeline can read them; logs what was dropped. */
export function validateFilms(
  films: readonly unknown[],
  provider: string,
  log: Logger,
): ScrapedFilm[] {
  const discards: Discards = new Map();
  const valid = films.flatMap((film) => validFilm(film, discards) ?? []);
  if (discards.size > 0) {
    log.warn("provider_output_discarded", {
      provider,
      discarded: Object.fromEntries([...discards].sort(([a], [b]) => (a < b ? -1 : 1))),
    });
  }
  return valid;
}
