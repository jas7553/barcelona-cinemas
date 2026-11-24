/**
 * The refresh's first half, in the order that matters: collection, reconciliation, enrichment,
 * reconciliation again.
 *
 * 1. Collection reconciles on title: before enrichment no film from a site without imdb ids has one.
 * 2. Enrichment adds TMDb's metadata, `imdb_id` included.
 * 3. Reconciliation runs again so copies listed under titles that never normalize alike (a Spanish
 *    and an English title) merge on the imdb id TMDb gave them both.
 *
 * No storage here: the previous refresh's snapshots and enrichment come in, the next refresh's go
 * out.
 */
import {
  collect,
  realTimer,
  type ProviderReport,
  type ProviderSnapshot,
  type ProviderSnapshots,
  type RetryPolicy,
  type Timer,
} from "./collect.ts";
import { reconcile } from "./reconcile.ts";
import {
  enrich,
  type EnrichedFilm,
  type EnrichmentStats,
  type PreviousEnrichment,
} from "./tmdb.ts";
import type { PipelineContext, Provider, ScrapedFilm } from "./types.ts";

export interface RefreshInput {
  providers: readonly Provider[];
  previousSnapshots?: ProviderSnapshots;
  previousEnrichment?: readonly PreviousEnrichment[];
  /** Without one, enrichment is skipped and the films go on as listed. */
  tmdbApiKey?: string | undefined;
  retry?: RetryPolicy;
  timer?: Timer;
}

/**
 * Every film the run drops is counted: `raw_movie_count - collection_merged_count -
 * post_enrichment_merged_count` is the number of films out.
 */
interface RefreshStats extends Partial<EnrichmentStats> {
  provider_success_count: number;
  provider_failure_count: number;
  provider_fallback_count: number;
  raw_movie_count: number;
  collection_merged_count: number;
  collected_movie_count: number;
  post_enrichment_merged_count: number;
}

export interface Refreshed {
  films: EnrichedFilm[];
  providers: ProviderReport[];
  stats: RefreshStats;
  /** The next refresh's `previousSnapshots`. */
  snapshots: Record<string, ProviderSnapshot>;
  /**
   * The next refresh's `previousEnrichment`: every TMDb match, taken before the second
   * reconciliation so a title it merges away still finds its match.
   */
  enriched: PreviousEnrichment[];
}

const countShowings = (films: readonly ScrapedFilm[]): number =>
  films.reduce((sum, film) => sum + film.showings.length, 0);

/** Throws `CollectionError` when no provider gave fresh films; see `collect`. */
export async function collectAndEnrich(
  ctx: PipelineContext,
  {
    providers,
    previousSnapshots = {},
    previousEnrichment = [],
    tmdbApiKey,
    retry,
    timer = realTimer,
  }: RefreshInput,
): Promise<Refreshed> {
  const started = timer.now();
  const previousFilms = Object.values(previousSnapshots).flatMap(({ films }) => films);
  const collection = await collect(
    providers,
    { ...ctx, previousFilms },
    { previousSnapshots, timer, ...(retry && { retry }) },
  );
  const collected = reconcile(collection.films, { stage: "collection", log: ctx.log });
  const reports = collection.providers;
  const failed = reports.filter(({ failure }) => failure !== undefined).length;
  const fallbacks = reports.filter(({ source }) => source === "fallback").length;
  ctx.log.info("collection_summary", {
    provider_count: reports.length - failed,
    failed_provider_count: failed,
    fallback_provider_count: fallbacks,
    duration_ms: Math.round(timer.now() - started),
    movie_count: collected.length,
    showtime_count: countShowings(collected),
  });

  let enriched: EnrichedFilm[] = collected;
  let enrichment: EnrichmentStats | undefined;
  if (tmdbApiKey === undefined) {
    ctx.log.warn("tmdb_enrichment_skipped", { reason: "no TMDb API key" });
  } else {
    ({ films: enriched, stats: enrichment } = await enrich(collected, ctx, {
      apiKey: tmdbApiKey,
      previous: previousEnrichment,
    }));
  }
  const films = reconcile(enriched, { stage: "post_enrichment", log: ctx.log });

  return {
    films,
    providers: reports,
    stats: {
      provider_success_count: reports.length - failed,
      provider_failure_count: failed,
      provider_fallback_count: fallbacks,
      raw_movie_count: collection.films.length,
      collection_merged_count: collection.films.length - collected.length,
      collected_movie_count: collected.length,
      post_enrichment_merged_count: enriched.length - films.length,
      ...enrichment,
    },
    snapshots: collection.snapshots,
    enriched: enriched.flatMap((film) =>
      film.tmdb_id === undefined ? [] : [{ ...film, showings: [] }],
    ),
  };
}
