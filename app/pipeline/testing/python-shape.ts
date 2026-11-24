/**
 * Test-only: the Python pipeline's output shape, for comparing a TS provider's films with the
 * goldens. Nothing here ships.
 */
import type { CinemaRegistry } from "../registry.ts";
import type { ScrapedFilm } from "../types.ts";

interface PythonShowtime {
  cinema: string;
  neighborhood: string;
  address: string;
  date: string;
  time: string;
  language: string;
  audio_lang?: string;
  subtitle_lang?: string;
  booking_url?: string;
  premium_format?: string;
}

export interface PythonMovie {
  title: string;
  tmdb_id: null;
  imdb_id: string | null;
  year: null;
  poster_url: null;
  synopsis: null;
  rating: null;
  runtime_mins: null;
  genres: null;
  showtimes: PythonShowtime[];
}

/**
 * Films as Python's `Movie`s. `starts_at` splits back into `date` and `time`; `neighborhood` and
 * `address` come from the registry, which the TS showing leaves to the published document. The
 * source labels have no Python counterpart (it kept only what it normalized), and the enrichment
 * fields are always null before enrichment.
 */
export function toPythonFilms(
  films: readonly ScrapedFilm[],
  registry: CinemaRegistry,
): PythonMovie[] {
  return films.map((film) => ({
    title: film.title,
    tmdb_id: null,
    imdb_id: film.imdb_id ?? null,
    year: null,
    poster_url: null,
    synopsis: null,
    rating: null,
    runtime_mins: null,
    genres: null,
    showtimes: film.showings.map((showing) => {
      const info = registry.get(showing.cinema);
      if (info === undefined) throw new Error(`${showing.cinema} is not in the registry`);
      return {
        cinema: showing.cinema,
        neighborhood: info.neighborhood,
        address: info.address,
        date: showing.starts_at.slice(0, 10),
        time: showing.starts_at.slice(11, 16),
        language: showing.language,
        ...(showing.audio_lang !== undefined && { audio_lang: showing.audio_lang }),
        ...(showing.subtitle_lang !== undefined && { subtitle_lang: showing.subtitle_lang }),
        ...(showing.booking_url !== undefined && { booking_url: showing.booking_url }),
        ...(showing.premium_format !== undefined && { premium_format: showing.premium_format }),
      };
    }),
  }));
}

// Python's providers (all but the catalog site) returned `reconcile(movies)`. The goldens carry
// that, and the TS pipeline reconciles in its own stage, so the parity tests stand in a copy of the
// legacy collapse over the projected shape, to compare like with like. Same-film copies merge
// (shared imdb_id, else title, a merged film answering to every title folded into it), showings
// dedupe by (date, time, cinema, language) keeping the optional fields any copy has, and merged
// showings sort by that key. A film seen once is left as it came.

const EDGE = new Set(Array.from(" \t\n\r\f\v!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~“”‘’`"));

/** Casefolded, whitespace collapsed, edge punctuation stripped. */
function normalizeTitle(title: string): string {
  const chars = Array.from(title);
  let start = 0;
  let end = chars.length;
  while (start < end && EDGE.has(chars[start] ?? "")) start += 1;
  while (end > start && EDGE.has(chars[end - 1] ?? "")) end -= 1;
  return chars.slice(start, end).join("").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

const identity = (s: PythonShowtime): string => [s.date, s.time, s.cinema, "vo"].join("\u0000");

const INFO_FIELDS = ["booking_url", "audio_lang", "subtitle_lang", "premium_format"] as const;

function mergeShowtimes(
  a: readonly PythonShowtime[],
  b: readonly PythonShowtime[],
): PythonShowtime[] {
  const byKey = new Map<string, PythonShowtime>();
  for (const showtime of [...a, ...b]) {
    const key = identity(showtime);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, showtime);
      continue;
    }
    const extras = Object.fromEntries(
      INFO_FIELDS.flatMap((field) =>
        showtime[field] !== undefined && existing[field] === undefined
          ? [[field, showtime[field]]]
          : [],
      ),
    );
    byKey.set(key, { ...existing, ...extras });
  }
  return [...byKey.values()].sort((x, y) => {
    const [kx, ky] = [identity(x), identity(y)];
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
}

/** The longer title, else the one that casefolds first. */
function pickTitle(left: string, right: string): string {
  const [l, r] = [Array.from(left).length, Array.from(right).length];
  if (l !== r) return l > r ? left : right;
  return right.toLowerCase() < left.toLowerCase() ? right : left;
}

export function pythonReconcile(movies: readonly PythonMovie[]): PythonMovie[] {
  const merged: PythonMovie[] = [];
  const titles: Set<string>[] = [];
  for (const movie of movies) {
    const title = normalizeTitle(movie.title);
    const index = merged.findIndex((existing, i) =>
      existing.imdb_id && movie.imdb_id
        ? existing.imdb_id === movie.imdb_id
        : titles[i]?.has(title),
    );
    const existing = merged[index];
    if (existing === undefined) {
      merged.push(movie);
      titles.push(new Set([title]));
    } else {
      merged[index] = {
        ...existing,
        title: pickTitle(existing.title, movie.title),
        imdb_id: existing.imdb_id ?? movie.imdb_id,
        showtimes: mergeShowtimes(existing.showtimes, movie.showtimes),
      };
      titles[index]?.add(title);
    }
  }
  return merged;
}
