/**
 * TMDb enrichment: each film's TMDb match and the metadata that comes with it (synopsis, rating,
 * runtime, genres, poster, trailer, director, cast). Per film: a search, then the candidates'
 * details, then the match's videos and credits. A film TMDb can't match, or a lookup that fails,
 * leaves the film as listed; enrichment never throws.
 */
import { madridWallClock } from "../shared/madrid.ts";
import { FetchError, HttpError } from "./errors.ts";
import type { Fetcher } from "./http.ts";
import { normalizeTitle } from "./reconcile.ts";
import {
  exactMatches,
  inSpanishFirstRun,
  isFeatureLength,
  MAX_DETAIL_PROBES,
  rankCandidates,
} from "./tmdb-rank.ts";
import {
  Credits,
  Detail,
  SearchResponse,
  tmdbMetadata,
  Videos,
  type SearchResult,
  type TmdbMetadata,
} from "./tmdb-schema.ts";
import type { PipelineContext, ScrapedFilm } from "./types.ts";

/**
 * Bump when the matching rules change, so matches made under the old rules are looked up again on
 * the next refresh rather than at their TTL.
 */
export const TMDB_MATCH_VERSION = 4;

const DEFAULT_ENRICH_TTL_DAYS = 7;

interface Enrichment extends TmdbMetadata {
  /** ISO-8601 instant of the lookup. */
  enriched_at: string;
  /** The `TMDB_MATCH_VERSION` the match was made under; absent reads as 1. */
  tmdb_match_version: number;
}

/**
 * A film after enrichment. Every enrichment field is optional: an unmatched film has none, and a
 * reused or merged one has whatever its sources had.
 */
export interface EnrichedFilm extends ScrapedFilm, Partial<Enrichment> {}

/** A film as an earlier enrichment left it; its showings don't matter. */
export type PreviousEnrichment = Omit<EnrichedFilm, "showings">;

export interface EnrichmentStats {
  tmdb_enriched_count: number;
  tmdb_reenriched_count: number;
  tmdb_cache_hit_count: number;
  tmdb_failure_count: number;
}

interface RetryPolicy {
  /** The wait before each retry; its length is the number of retries. */
  delaysMs: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

/** Two retries on a 5xx or no response: at once, then after 2 s. */
const TMDB_RETRY: RetryPolicy = { delaysMs: [0, 2000] };

export interface EnrichOptions {
  apiKey: string;
  /** Earlier results, reused while within `ttlDays` and the current match version. */
  previous?: readonly PreviousEnrichment[];
  ttlDays?: number;
  retry?: RetryPolicy;
}

const BASE_URL = "https://api.themoviedb.org/3";
const TIMEOUT_MS = 10_000;
const RETRY_STATUSES: ReadonlySet<number> = new Set([500, 502, 503, 504]);
const DAY_MS = 86_400_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorDetail(error: unknown): string {
  if (error instanceof HttpError) return `HTTP ${error.status}`;
  return error instanceof Error ? error.name : typeof error;
}

class TmdbClient {
  readonly #fetcher: Fetcher;
  readonly #apiKey: string;
  readonly #retry: RetryPolicy;

  constructor(fetcher: Fetcher, apiKey: string, retry: RetryPolicy) {
    this.#fetcher = fetcher;
    this.#apiKey = apiKey;
    this.#retry = retry;
  }

  async #get(path: string, params: Readonly<Record<string, string>> = {}): Promise<unknown> {
    const query = new URLSearchParams({ language: "en-US", api_key: this.#apiKey, ...params });
    const url = `${BASE_URL}${path}?${query.toString()}`;
    const { delaysMs, sleep = wait } = this.#retry;
    for (let attempt = 0; ; attempt++) {
      const delay = delaysMs[attempt];
      let response;
      try {
        response = await this.#fetcher.get(url, { timeoutMs: TIMEOUT_MS });
      } catch (error) {
        if (!(error instanceof FetchError) || delay === undefined) throw error;
        await sleep(delay);
        continue;
      }
      if (RETRY_STATUSES.has(response.status) && delay !== undefined) {
        await sleep(delay);
        continue;
      }
      // The key is in `url`: report the path only.
      if (response.status >= 400) throw new HttpError(response.status, `${BASE_URL}${path}`);
      return JSON.parse(response.text);
    }
  }

  async search(query: string, language = "en-US"): Promise<SearchResult[]> {
    const body = await this.#get("/search/movie", { query, language });
    return SearchResponse.parse(body).results;
  }

  async detail(id: number): Promise<Detail> {
    return Detail.parse(await this.#get(`/movie/${id}`, { append_to_response: "release_dates" }));
  }

  /** The body, or `undefined` when the request fails. */
  async optional(path: string, onError: (error: unknown) => void): Promise<unknown> {
    try {
      return await this.#get(path);
    } catch (error) {
      onError(error);
      return undefined;
    }
  }
}

interface LookupResult {
  film: EnrichedFilm;
  enriched: boolean;
  failed: boolean;
}

/**
 * The TMDb match for a listed title, or `undefined`.
 *
 * `knownTitle` is the English title an earlier match gave this listing. It's searched only when
 * the listed title names no film exactly, in English or Spanish: searching it first would repeat
 * an earlier wrong guess forever.
 */
async function findMatch(
  client: TmdbClient,
  film: ScrapedFilm,
  {
    today,
    knownTitle,
    ctx,
  }: { today: string; knownTitle: string | undefined; ctx: PipelineContext },
): Promise<TmdbMetadata | undefined> {
  let title = film.title;
  let results = await client.search(title);
  if (exactMatches(title, results).length === 0) {
    // Probably a Spanish-titled listing. TMDb found these films by some translation of their title
    // but names them in English, so nothing says which one is meant. Named in Spanish, the film
    // whose title this is can be told from one that merely resembles it.
    const spanish = results.length > 0 ? await client.search(title, "es-ES") : [];
    if (exactMatches(title, spanish).length > 0) {
      results = spanish;
    } else if (knownTitle && normalizeTitle(knownTitle) !== normalizeTitle(title)) {
      title = knownTitle;
      results = await client.search(knownTitle);
    }
  }

  const { firstRun, ordered } = rankCandidates(title, results, { year: film.year, today });
  const details = new Map<number, Detail>();
  const detailOf = async (candidate: SearchResult): Promise<Detail> => {
    const known = details.get(candidate.id);
    if (known) return known;
    const detail = await client.detail(candidate.id);
    details.set(candidate.id, detail);
    return detail;
  };

  // Runtime and release dates are only in the detail, so each probe costs a request.
  let chosen: SearchResult | undefined;
  for (const candidate of firstRun) {
    const detail = await detailOf(candidate);
    if (inSpanishFirstRun(detail, today) && isFeatureLength(detail)) {
      chosen = candidate;
      break;
    }
  }
  if (chosen === undefined) {
    for (const candidate of ordered.slice(0, MAX_DETAIL_PROBES)) {
      chosen ??= candidate;
      if (isFeatureLength(await detailOf(candidate))) {
        chosen = candidate;
        break;
      }
    }
  }
  if (chosen === undefined) return undefined;

  const detail = await detailOf(chosen);
  const warn = (part: string) => (error: unknown) => {
    ctx.log.warn("tmdb_fetch_failed", { title, part, error: errorDetail(error) });
  };
  const videos = Videos.safeParse(
    await client.optional(`/movie/${chosen.id}/videos`, warn("videos")),
  );
  const credits = Credits.safeParse(
    await client.optional(`/movie/${chosen.id}/credits`, warn("credits")),
  );
  return tmdbMetadata(detail, videos.data, credits.data);
}

async function lookUp(
  client: TmdbClient,
  film: ScrapedFilm,
  ctx: PipelineContext,
  knownTitle?: string,
): Promise<LookupResult> {
  let metadata;
  try {
    metadata = await findMatch(client, film, {
      today: madridWallClock(ctx.now).date,
      knownTitle,
      ctx,
    });
  } catch (error) {
    ctx.log.warn("tmdb_lookup_failed", { title: film.title, error: errorDetail(error) });
    return { film, enriched: false, failed: true };
  }
  if (metadata === undefined) return { film, enriched: false, failed: false };
  // TMDb's imdb id and year replace the source's, even when TMDb has none.
  const enriched: EnrichedFilm = {
    title: film.title,
    showings: film.showings,
    ...metadata,
    enriched_at: ctx.now.toISOString(),
    tmdb_match_version: TMDB_MATCH_VERSION,
  };
  return { film: enriched, enriched: true, failed: false };
}

/** An offset-less instant is UTC, as the Python pipeline wrote them. */
function parseInstant(value: string): number {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const zoned = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(value);
  return Date.parse(dateOnly || zoned ? value : `${value}Z`);
}

function needsLookup(previous: PreviousEnrichment, now: Date, ttlDays: number): boolean {
  if ((previous.tmdb_match_version ?? 1) < TMDB_MATCH_VERSION) return true;
  if (!previous.enriched_at) return true;
  const enrichedAt = parseInstant(previous.enriched_at);
  return Number.isNaN(enrichedAt) || now.getTime() - enrichedAt > ttlDays * DAY_MS;
}

/** Finds a film's earlier result by imdb id, else by its listed or English title. */
function previousIndex(
  previous: readonly PreviousEnrichment[],
): (film: ScrapedFilm) => PreviousEnrichment | undefined {
  const byImdb = new Map<string, PreviousEnrichment>();
  const byTitle = new Map<string, PreviousEnrichment>();
  for (const film of previous) {
    if (film.imdb_id) byImdb.set(film.imdb_id, film);
    // The English title too: another provider's Spanish-titled listing may hold the match.
    if (film.english_title) byTitle.set(film.english_title.toLowerCase(), film);
  }
  for (const film of previous) byTitle.set(film.title.toLowerCase(), film);
  return (film) =>
    (film.imdb_id ? byImdb.get(film.imdb_id) : undefined) ?? byTitle.get(film.title.toLowerCase());
}

function englishKey(film: EnrichedFilm): string {
  return normalizeTitle(film.english_title ?? film.title);
}

/** Indexes of the films whose English title another matched film shares. */
function namesakeClashes(films: readonly EnrichedFilm[]): Set<number> {
  const idsByTitle = new Map<string, Set<number>>();
  for (const film of films) {
    if (film.tmdb_id === undefined) continue;
    const key = englishKey(film);
    idsByTitle.set(key, (idsByTitle.get(key) ?? new Set()).add(film.tmdb_id));
  }
  const clashes = new Set<number>();
  for (const [index, film] of films.entries()) {
    if (film.tmdb_id !== undefined && (idsByTitle.get(englishKey(film))?.size ?? 0) > 1) {
      clashes.add(index);
    }
  }
  return clashes;
}

/**
 * Each film with its TMDb metadata, in input order. An earlier result is reused while fresh; a
 * stale one whose lookup fails or finds nothing is kept rather than lost. Logs
 * `tmdb_enrichment_summary`.
 */
export async function enrich(
  films: readonly ScrapedFilm[],
  ctx: PipelineContext,
  { apiKey, previous = [], ttlDays = DEFAULT_ENRICH_TTL_DAYS, retry = TMDB_RETRY }: EnrichOptions,
): Promise<{ films: EnrichedFilm[]; stats: EnrichmentStats }> {
  const client = new TmdbClient(ctx.fetcher, apiKey, retry);
  const findPrevious = previousIndex(previous);
  const stats: EnrichmentStats = {
    tmdb_enriched_count: 0,
    tmdb_reenriched_count: 0,
    tmdb_cache_hit_count: 0,
    tmdb_failure_count: 0,
  };
  const count = (result: LookupResult): void => {
    if (result.enriched) stats.tmdb_enriched_count++;
    if (result.failed) stats.tmdb_failure_count++;
  };

  const enriched: EnrichedFilm[] = [];
  const reused = new Set<number>();
  for (const [index, film] of films.entries()) {
    const earlier = findPrevious(film);
    const match = earlier?.tmdb_id === undefined ? undefined : earlier;
    if (match && !needsLookup(match, ctx.now, ttlDays)) {
      reused.add(index);
      enriched.push({ ...match, showings: film.showings });
      continue;
    }
    if (match) stats.tmdb_reenriched_count++;
    const result = await lookUp(client, film, ctx, earlier?.english_title);
    count(result);
    enriched.push(!result.enriched && match ? { ...match, showings: film.showings } : result.film);
  }

  // A reused match can be stale (a classic matched before its remake was listed) or reached
  // through a provider's wrong imdb id. Either shows up as two films sharing an English title, so
  // those are looked up again by their listed title, as if nothing had been reused.
  const clashes = namesakeClashes(enriched);
  for (const index of [...reused].filter((i) => clashes.has(i)).sort((a, b) => a - b)) {
    const film = films[index];
    if (film === undefined) continue;
    reused.delete(index);
    stats.tmdb_reenriched_count++;
    const result = await lookUp(client, film, ctx);
    count(result);
    if (result.enriched) enriched[index] = result.film;
  }
  stats.tmdb_cache_hit_count = reused.size;

  ctx.log.info("tmdb_enrichment_summary", { movie_count: films.length, ...stats });
  return { films: enriched, stats };
}
