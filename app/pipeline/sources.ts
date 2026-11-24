/** Every live source the pipeline reads, and `npm run record`'s run through them. */
import { liveFetcher, type Fetcher } from "./http.ts";
import type { Logger } from "./log.ts";
import { recordingFetcher } from "./recordings.ts";
import type { CinemaRegistry } from "./registry.ts";
import type { PipelineContext, Provider, ScrapedFilm } from "./types.ts";

/** Values kept out of the repo. Absent when unset: each source decides whether it can run without. */
export interface SourceConfig {
  listingsFeedUrl?: string;
  secondaryListingsUrl?: string;
  tmdbApiKey?: string;
}

/** `missing` names the variables unset or blank. */
export function sourceConfigFromEnv(env: Readonly<Record<string, string | undefined>>): {
  config: SourceConfig;
  missing: string[];
} {
  const config: SourceConfig = {};
  const missing: string[] = [];
  const read = (name: string, set: (value: string) => void): void => {
    const value = env[name]?.trim();
    if (value) set(value);
    else missing.push(name);
  };
  read("LISTINGS_FEED_URL", (value) => {
    config.listingsFeedUrl = value;
  });
  read("SECONDARY_LISTINGS_URL", (value) => {
    config.secondaryListingsUrl = value;
  });
  read("TMDB_API_KEY", (value) => {
    config.tmdbApiKey = value;
  });
  return { config, missing };
}

export interface LiveSources {
  providers: readonly ((config: SourceConfig) => Provider)[];
  /** Runs on every film the providers found, so a recording covers its requests too. */
  enrich?: (
    films: readonly ScrapedFilm[],
    ctx: PipelineContext,
    config: SourceConfig,
  ) => Promise<unknown>;
}

/** Providers and enrichment register here as they're ported. */
export const liveSources: LiveSources = { providers: [] };

export interface RecordOptions {
  outDir: string;
  now: Date;
  registry: CinemaRegistry;
  log: Logger;
  fetcher?: Fetcher;
}

/**
 * Runs `sources` from a cold start through a recorder and writes the recording to `outDir`. A
 * source that fails is logged and the rest still run; returns the names of those that failed.
 */
export async function recordSources(
  sources: LiveSources,
  config: SourceConfig,
  { outDir, now, registry, log, fetcher = liveFetcher() }: RecordOptions,
): Promise<string[]> {
  const recorder = recordingFetcher(fetcher);
  const ctx: PipelineContext = { fetcher: recorder.fetcher, now, registry, log };
  const failed: string[] = [];
  const films: ScrapedFilm[] = [];
  for (const build of sources.providers) {
    let name = "(unbuilt provider)";
    try {
      const provider = build(config);
      name = provider.name;
      const result = await provider.fetch({ ...ctx, previousFilms: [] });
      films.push(...result.films);
      log.info("record_provider", { provider: name, film_count: result.films.length });
    } catch (error) {
      failed.push(name);
      log.error("record_provider_failed", { provider: name, error: String(error) });
    }
  }
  if (sources.enrich) {
    try {
      await sources.enrich(films, ctx, config);
    } catch (error) {
      failed.push("enrich");
      log.error("record_enrich_failed", { error: String(error) });
    }
  }
  recorder.save(outDir);
  return failed;
}
