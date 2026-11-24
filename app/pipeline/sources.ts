/** Every live source the pipeline reads, and `npm run record`'s run through them. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { errorMessage } from "./errors.ts";
import { liveFetcher, type Fetcher } from "./http.ts";
import type { Logger } from "./log.ts";
import { englishCinemaBcnProvider } from "./providers/englishCinemaBcn.ts";
import { secondaryProvider } from "./providers/secondary.ts";
import { sensacineProvider, type SensacineOptions } from "./providers/sensacine.ts";
import { verdiProvider, type VerdiOptions } from "./providers/verdi.ts";
import { recordingFetcher } from "./recordings.ts";
import type { CinemaRegistry } from "./registry.ts";
import { enrichIfKeyed } from "./tmdb.ts";
import type { PipelineContext, Provider, ScrapedFilm } from "./types.ts";

/** Values kept out of the repo. Absent when unset: each source decides whether it can run without. */
export interface SourceConfig {
  listingsFeedUrl?: string;
  secondaryListingsUrl?: string;
  tmdbApiKey?: string;
  /** Narrows the public sources to the pages a recording holds. */
  verdi?: VerdiOptions;
  sensacine?: SensacineOptions;
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

/** Every provider, and enrichment. */
export const liveSources: LiveSources = {
  providers: [
    (config) => englishCinemaBcnProvider({ feedUrl: config.listingsFeedUrl }),
    (config) => secondaryProvider({ listingsUrl: config.secondaryListingsUrl }),
    (config) => verdiProvider(config.verdi),
    (config) => sensacineProvider(config.sensacine),
  ],
  enrich: async (films, ctx, { tmdbApiKey }) =>
    (await enrichIfKeyed(films, ctx, { apiKey: tmdbApiKey })).films,
};

/** What a recording stores in place of each secret URL. */
const STAND_INS: Readonly<Record<"listingsFeedUrl" | "secondaryListingsUrl", string>> = {
  listingsFeedUrl: "https://listings-feed.example.test/feed",
  secondaryListingsUrl: "https://secondary-listings.example.test/listings",
};

const SECRET_URLS: readonly (keyof typeof STAND_INS)[] = [
  "listingsFeedUrl",
  "secondaryListingsUrl",
];

export interface RecordOptions {
  outDir: string;
  now: Date;
  registry: CinemaRegistry;
  log: Logger;
  fetcher?: Fetcher;
}

/**
 * Runs `sources` from a cold start through a recorder and writes the recording to `outDir`, with a
 * `case.json` that replays it: the instant, and the secret URLs as the stand-ins stored in their
 * place, over whatever else an earlier `case.json` there held. A source that fails is logged and
 * the rest still run; returns the names of those that failed.
 */
export async function recordSources(
  sources: LiveSources,
  config: SourceConfig,
  { outDir, now, registry, log, fetcher = liveFetcher() }: RecordOptions,
): Promise<string[]> {
  const secrets = SECRET_URLS.flatMap((key) => {
    const secret = config[key];
    return secret === undefined ? [] : [{ key, secret, standIn: STAND_INS[key] }];
  });
  const recorder = recordingFetcher(fetcher, secrets);
  const ctx: PipelineContext = { fetcher: recorder.fetcher, now, registry, log };
  const failed: string[] = [];
  const films: ScrapedFilm[] = [];
  for (const build of sources.providers) {
    let name = "(unbuilt provider)";
    let secretUrls = false;
    try {
      const provider = build(config);
      name = provider.name;
      secretUrls = provider.secretUrls ?? false;
      const result = await provider.fetch({ ...ctx, previousFilms: [] });
      films.push(...result.films);
      log.info("record_provider", { provider: name, film_count: result.films.length });
    } catch (error) {
      failed.push(name);
      log.error("record_provider_failed", { provider: name, error: errorText(error, secretUrls) });
    }
  }
  if (sources.enrich) {
    try {
      await sources.enrich(films, ctx, config);
    } catch (error) {
      failed.push("enrich");
      log.error("record_enrich_failed", { error: errorText(error, true) });
    }
  }
  const casePath = join(outDir, "case.json");
  const previousCase = existsSync(casePath)
    ? z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(casePath, "utf8")))
    : {};
  const replayConfig = Object.fromEntries(
    secrets.map(({ key, secret }) => [key, recorder.stored(secret)]),
  );
  recorder.save(outDir, {
    "case.json": { ...previousCase, now: now.toISOString(), config: replayConfig },
  });
  return failed;
}

/** As `String(error)` puts it, without the URL of a source whose URLs are secret. */
function errorText(error: unknown, hideUrl: boolean): string {
  return error instanceof Error ? `${error.name}: ${errorMessage(error, hideUrl)}` : String(error);
}

const ReplayCase = z.looseObject({
  now: z.iso.datetime({ offset: true }),
  config: z
    .looseObject({
      listingsFeedUrl: z.string().optional(),
      secondaryListingsUrl: z.string().optional(),
    })
    .optional(),
  verdi: z.object({ slugs: z.array(z.string()) }).optional(),
  sensacine: z
    .object({ ids: z.record(z.string(), z.string()), daysAhead: z.int().positive() })
    .optional(),
});

/**
 * A recording's `case.json`: the instant it stands for, and the config and narrowing its sources
 * were recorded with.
 */
export function readReplayCase(dir: string): { now: Date; config: SourceConfig } {
  const {
    now,
    config = {},
    verdi,
    sensacine,
  } = ReplayCase.parse(JSON.parse(readFileSync(join(dir, "case.json"), "utf8")));
  return {
    now: new Date(now),
    config: {
      ...(config.listingsFeedUrl !== undefined && { listingsFeedUrl: config.listingsFeedUrl }),
      ...(config.secondaryListingsUrl !== undefined && {
        secondaryListingsUrl: config.secondaryListingsUrl,
      }),
      ...(verdi && { verdi }),
      ...(sensacine && { sensacine }),
    },
  };
}
