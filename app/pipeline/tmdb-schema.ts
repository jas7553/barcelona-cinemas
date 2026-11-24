/**
 * The TMDb responses enrichment reads. A malformed field is dropped rather than failing the film:
 * the rest of the payload is still worth having.
 */
import { z } from "zod";

/** An optional field: absent when missing or malformed. */
function lenient<T extends z.ZodType>(schema: T) {
  return schema.optional().catch(undefined);
}

/** `items` that parse, the rest dropped. */
function each<T extends z.ZodType>(item: T) {
  return z.array(z.unknown()).transform((items) =>
    items.flatMap((raw) => {
      const parsed = item.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  );
}

const Text = z.string().trim().min(1);

const SearchResult = z.object({
  id: z.int(),
  title: z.string().catch(""),
  release_date: lenient(z.string()),
  genre_ids: z.array(z.int()).catch([]),
});
export type SearchResult = z.infer<typeof SearchResult>;

export const SearchResponse = z.object({ results: each(SearchResult).catch([]) });

const CinemaRelease = z.object({
  type: lenient(z.int()),
  release_date: lenient(z.string()),
});

const CountryReleases = z.object({
  iso_3166_1: lenient(z.string()),
  release_dates: each(CinemaRelease).catch([]),
});

const Genre = z.object({ name: Text }).transform((genre) => genre.name);

export const Detail = z.object({
  id: lenient(z.int()),
  title: lenient(Text),
  overview: lenient(Text),
  tagline: lenient(Text),
  vote_average: lenient(z.number().min(0).max(10)),
  vote_count: lenient(z.int().min(0)),
  /** As given: TMDb's 0 (unknown) and negative values matter to ranking. */
  runtime: lenient(z.int()),
  genres: lenient(each(Genre)),
  poster_path: lenient(Text.regex(/^\/[^?#]+$/)),
  backdrop_path: lenient(Text.regex(/^\/[^?#]+$/)),
  original_language: lenient(Text.toLowerCase().regex(/^[a-z]{2,3}$/)),
  release_date: lenient(z.string()),
  imdb_id: lenient(Text.regex(/^tt\d+$/)),
  release_dates: z.object({ results: each(CountryReleases).catch([]) }).catch({ results: [] }),
});
export type Detail = z.infer<typeof Detail>;

const Video = z.object({
  site: z.unknown().optional(),
  type: z.unknown().optional(),
  official: z.unknown().optional(),
  key: z.unknown().optional(),
});

export const Videos = z.object({ results: each(Video) });
export type Videos = z.infer<typeof Videos>;

const Person = z.object({ name: z.unknown().optional(), job: z.unknown().optional() });

export const Credits = z.object({ crew: lenient(each(Person)), cast: lenient(each(Person)) });
export type Credits = z.infer<typeof Credits>;

const POSTER_BASE = "https://image.tmdb.org/t/p/w342";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
const MAX_CAST = 5;

/** What enrichment takes from TMDb. Absent fields are unknown. */
export interface TmdbMetadata {
  tmdb_id: number;
  imdb_id?: string;
  year?: number;
  poster_url?: string;
  backdrop_url?: string;
  trailer_url?: string;
  synopsis?: string;
  tagline?: string;
  /** 0–10; 0 with no votes yet. */
  rating?: number;
  vote_count?: number;
  runtime_mins?: number;
  genres?: string[];
  /** Comma-joined when several. */
  director?: string;
  /** Top billed, at most five. */
  cast?: string[];
  /** TMDb's title, in English. */
  english_title?: string;
  /** ISO 639 code, e.g. `"fr"`. */
  original_lang?: string;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The official YouTube trailer, else the first YouTube trailer. */
function trailerUrl(videos: Videos | undefined): string | undefined {
  const trailers = (videos?.results ?? []).filter(
    (video) => video.site === "YouTube" && video.type === "Trailer",
  );
  const pick = trailers.find((video) => video.official === true) ?? trailers[0];
  const key = nonEmpty(pick?.key);
  return key === undefined ? undefined : `https://www.youtube.com/watch?v=${key}`;
}

function director(credits: Credits | undefined): string | undefined {
  const names = new Set<string>();
  for (const member of credits?.crew ?? []) {
    const name = member.job === "Director" ? nonEmpty(member.name) : undefined;
    if (name !== undefined) names.add(name);
  }
  return names.size > 0 ? [...names].join(", ") : undefined;
}

function cast(credits: Credits | undefined): string[] | undefined {
  const names = (credits?.cast ?? []).flatMap((member) => nonEmpty(member.name) ?? []);
  return names.length > 0 ? names.slice(0, MAX_CAST) : undefined;
}

function year(releaseDate: string | undefined): number | undefined {
  const digits = releaseDate?.slice(0, 4);
  return digits !== undefined && /^\d{4}$/.test(digits) ? Number(digits) : undefined;
}

/** `undefined` when the detail has no id. */
export function tmdbMetadata(
  detail: Detail,
  videos: Videos | undefined,
  credits: Credits | undefined,
): TmdbMetadata | undefined {
  const { id } = detail;
  if (id === undefined) return undefined;
  const releaseYear = year(detail.release_date);
  const trailer = trailerUrl(videos);
  const directors = director(credits);
  const topCast = cast(credits);
  const d = detail;
  return {
    tmdb_id: id,
    ...(d.imdb_id !== undefined && { imdb_id: d.imdb_id }),
    ...(releaseYear !== undefined && { year: releaseYear }),
    ...(d.poster_path !== undefined && { poster_url: `${POSTER_BASE}${d.poster_path}` }),
    ...(d.backdrop_path !== undefined && { backdrop_url: `${BACKDROP_BASE}${d.backdrop_path}` }),
    ...(trailer !== undefined && { trailer_url: trailer }),
    ...(d.overview !== undefined && { synopsis: d.overview }),
    ...(d.tagline !== undefined && { tagline: d.tagline }),
    ...(d.vote_average !== undefined && { rating: d.vote_average }),
    ...(d.vote_count !== undefined && { vote_count: d.vote_count }),
    ...(d.runtime !== undefined && d.runtime > 0 && { runtime_mins: d.runtime }),
    ...(d.genres !== undefined && d.genres.length > 0 && { genres: d.genres }),
    ...(directors !== undefined && { director: directors }),
    ...(topCast !== undefined && { cast: topCast }),
    ...(d.title !== undefined && { english_title: d.title }),
    ...(d.original_language !== undefined && { original_lang: d.original_language }),
  };
}
