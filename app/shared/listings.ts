/**
 * The `v2` data document (`v2/listings.json`): the pipeline writes it, the renderer reads it. These
 * schemas are the only definition of its types.
 *
 * - Missing data is an absent key, never `null`, `""` or `[]`: a present list has at least one item.
 * - Showings nest under their film, which every page starts from, and name their cinema by id.
 * - `starts_at` is ISO-8601 at Madrid's offset for that instant (`2026-11-23T21:00+01:00`): one
 *   unambiguous instant, whose date and `HH:MM` are also the Madrid wall clock. The cinema day is
 *   derived from it in domain code, never stored.
 * - Images and trailers are stored as TMDb poster paths and YouTube keys: the renderer picks the
 *   poster sizes, and URLs can only point at `image.tmdb.org` and YouTube.
 */
import { z } from "zod";
import { madridWallClock } from "./madrid.ts";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILM_ID = /^(?:[1-9][0-9]*|(?=[a-z0-9-]*[a-z])[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const TMDB_ID = /^[1-9][0-9]*$/;
const STARTS_AT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})[+-]\d{2}:\d{2}$/;

const Text = z.string().regex(/^\S(?:[\s\S]*\S)?$/, "non-empty, no surrounding whitespace");
const IsoDate = z.iso.date();
const Instant = z.iso.datetime({ offset: true });

/** A TMDb id (`"550"`), else a slug of the title with at least one letter (`"mirall-trencat"`). */
const FilmId = z.string().regex(FILM_ID, "TMDb id or a slug with a letter");
const CinemaId = z.string().regex(SLUG, "slug");

function isMadridWallClock(value: string): boolean {
  const match = STARTS_AT.exec(value);
  const instant = new Date(value);
  if (match === null || Number.isNaN(instant.getTime())) return false;
  const wall = madridWallClock(instant);
  return wall.date === match[1] && wall.time === match[2];
}

const StartsAt = z
  .string()
  .refine(isMadridWallClock, "Madrid wall clock at Madrid's offset, e.g. 2026-11-23T21:00+01:00");

export const Cinema = z
  .strictObject({
    id: CinemaId,
    name: Text,
    short_name: Text,
    chain: z.enum(["Mooby", "Cinesa", "Yelmo", "Verdi", "Renoir", "Independent"]),
    /** The letters on its icon. */
    code: z.string().regex(/^[A-Z][A-Za-z]$/, "two letters, the first a capital"),
    neighborhood: Text,
    description: Text,
    /** Bounded to greater Barcelona, which catches swapped coordinates. */
    lat: z.number().min(41.2).max(41.6),
    lng: z.number().min(1.9).max(2.4),
    place_id: z.string().regex(/^[\w-]{20,}$/, "Google place ID (opaque)"),
    website_url: z.httpUrl(),
    /**
     * `full`: a source lists the whole programme, so `published_through` is exact. `english_only`:
     * only the English feed lists it, so `published_through` is a lower bound.
     */
    coverage: z.enum(["full", "english_only"]),
    /** The latest cinema day with any showing in its sources, including showings left out here. */
    published_through: IsoDate.exactOptional(),
    /** When any of its sources last answered. */
    checked_at: Instant.exactOptional(),
  })
  .refine((c) => c.published_through === undefined || c.checked_at !== undefined, {
    message: "published_through needs checked_at",
    path: ["checked_at"],
  });

export const Showing = z.strictObject({
  cinema_id: CinemaId,
  starts_at: StartsAt,
  version: z.enum(["original", "dubbed"]),
  audio: z.enum(["en", "other", "unknown"]),
  booking_url: z.httpUrl().exactOptional(),
});

export const Film = z
  .strictObject({
    id: FilmId,
    /** Ids this film had before, whose URLs and seen entries move to `id`. */
    previous_ids: z.array(FilmId).min(1).exactOptional(),
    title: Text,
    /** Present iff the film is matched on TMDb; `id` is then this number. */
    tmdb_id: z.int().positive().exactOptional(),
    imdb_id: z
      .string()
      .regex(/^tt\d{7,}$/)
      .exactOptional(),
    year: z.int().min(1888).max(2100).exactOptional(),
    runtime_minutes: z.int().positive().exactOptional(),
    genres: z.array(Text).min(1).exactOptional(),
    rating: z
      .strictObject({ average: z.number().min(0).max(10), votes: z.int().positive() })
      .exactOptional(),
    popularity: z.number().nonnegative().exactOptional(),
    tagline: Text.exactOptional(),
    directors: z.array(Text).min(1).exactOptional(),
    cast: z.array(Text).min(1).exactOptional(),
    synopsis: Text.exactOptional(),
    /** For `https://image.tmdb.org/t/p/<size><poster_path>`. */
    poster_path: z
      .string()
      .regex(/^\/[\w-]+\.(?:jpg|jpeg|png|webp)$/)
      .exactOptional(),
    trailer_youtube_key: z
      .string()
      .regex(/^[\w-]{11}$/)
      .exactOptional(),
    showings: z.array(Showing).min(1),
  })
  .superRefine((film, ctx) => {
    const idOk =
      film.tmdb_id === undefined ? !TMDB_ID.test(film.id) : film.id === String(film.tmdb_id);
    if (!idOk) {
      ctx.addIssue({
        code: "custom",
        message: "a matched film's id is its tmdb_id; an unmatched film's id is a slug",
        path: ["id"],
      });
    }
    const seen = new Set<string>();
    film.showings.forEach((s, i) => {
      const key = `${s.cinema_id} ${s.starts_at} ${s.version}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "duplicate showing",
          path: ["showings", i],
        });
      }
      seen.add(key);
    });
  });

function rejectDuplicates(
  ctx: z.RefinementCtx,
  values: readonly string[],
  path: (index: number) => (string | number)[],
  what: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, i) => {
    if (seen.has(value)) {
      ctx.addIssue({ code: "custom", message: `duplicate ${what}`, path: path(i) });
    }
    seen.add(value);
  });
}

export const Listings = z
  .strictObject({
    schema_version: z.literal(2),
    generated_at: Instant,
    cinemas: z.array(Cinema).min(1),
    films: z.array(Film),
  })
  .superRefine((doc, ctx) => {
    rejectDuplicates(
      ctx,
      doc.cinemas.map((c) => c.id),
      (i) => ["cinemas", i, "id"],
      "cinema id",
    );
    rejectDuplicates(
      ctx,
      doc.cinemas.map((c) => c.code),
      (i) => ["cinemas", i, "code"],
      "cinema code",
    );
    rejectDuplicates(
      ctx,
      doc.films.map((f) => f.id),
      (i) => ["films", i, "id"],
      "film id",
    );

    const filmIds = new Set(doc.films.map((f) => f.id));
    const claimed = new Set<string>();
    doc.films.forEach((film, i) => {
      film.previous_ids?.forEach((previous, j) => {
        const path = ["films", i, "previous_ids", j];
        if (filmIds.has(previous)) {
          ctx.addIssue({ code: "custom", message: "previous id is a current film id", path });
        } else if (claimed.has(previous)) {
          ctx.addIssue({ code: "custom", message: "previous id claimed by two films", path });
        }
        claimed.add(previous);
      });
    });

    const cinemaIds = new Set(doc.cinemas.map((c) => c.id));
    const showingCinemaIds = new Set<string>();
    doc.films.forEach((film, i) => {
      film.showings.forEach((s, j) => {
        if (!cinemaIds.has(s.cinema_id)) {
          ctx.addIssue({
            code: "custom",
            message: `unknown cinema ${s.cinema_id}`,
            path: ["films", i, "showings", j, "cinema_id"],
          });
        }
        showingCinemaIds.add(s.cinema_id);
      });
    });

    const generatedAt = Date.parse(doc.generated_at);
    doc.cinemas.forEach((c, i) => {
      if (showingCinemaIds.has(c.id) && c.published_through === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "a cinema with showings needs published_through",
          path: ["cinemas", i, "published_through"],
        });
      }
      if (c.checked_at !== undefined && Date.parse(c.checked_at) > generatedAt) {
        ctx.addIssue({
          code: "custom",
          message: "checked_at is after generated_at",
          path: ["cinemas", i, "checked_at"],
        });
      }
    });
  });

export type Cinema = z.infer<typeof Cinema>;
export type Showing = z.infer<typeof Showing>;
export type Film = z.infer<typeof Film>;
export type Listings = z.infer<typeof Listings>;
