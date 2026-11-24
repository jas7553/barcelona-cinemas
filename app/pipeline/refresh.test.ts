import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Timer } from "./collect.ts";
import type { Logger } from "./log.ts";
import { replayFetcher } from "./recordings.ts";
import { collectAndEnrich } from "./refresh.ts";
import { parseRegistry } from "./registry.ts";
import { liveSources, readReplayCase } from "./sources.ts";
import { canonicalPython, toCanonicalPython } from "./testing/python.ts";
import { TMDB_MATCH_VERSION, type PreviousEnrichment } from "./tmdb.ts";
import type { PipelineContext, Provider, ProviderContext, ScrapedFilm } from "./types.ts";

const NOW = new Date("2026-03-27T09:00:00Z");
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

const quiet: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Retries don't wait. */
const timer: Timer = { now: () => 0, sleep: () => Promise.resolve() };

function context(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    fetcher: { get: (url) => Promise.reject(new Error(`unexpected request: ${url}`)) },
    now: NOW,
    registry: parseRegistry({}),
    log: quiet,
    ...overrides,
  };
}

function film(
  title: string,
  startsAt = "2026-03-28T18:00+01:00",
  extra: Partial<ScrapedFilm> = {},
): ScrapedFilm {
  return { title, showings: [{ cinema: "Verdi", starts_at: startsAt, language: "vo" }], ...extra };
}

function provider(name: string, films: ScrapedFilm[] | Error): Provider {
  return {
    name,
    fetch: () => (films instanceof Error ? Promise.reject(films) : Promise.resolve({ films })),
  };
}

/** A fresh TMDb match, reused without a request. */
function match(title: string, tmdbId: number, imdbId: string): PreviousEnrichment {
  return {
    title,
    tmdb_id: tmdbId,
    imdb_id: imdbId,
    english_title: "Wuthering Heights",
    enriched_at: NOW.toISOString(),
    tmdb_match_version: TMDB_MATCH_VERSION,
  };
}

describe("collectAndEnrich", () => {
  it("reconciles on title before enrichment", async () => {
    const { films, stats } = await collectAndEnrich(context(), {
      providers: [
        provider("one", [film("Project Hail Mary")]),
        provider("two", [
          film("Project Hail Mary", "2026-03-29T20:00+01:00", { imdb_id: "tt12042730" }),
        ]),
      ],
      timer,
    });

    expect(stats).toMatchObject({
      raw_movie_count: 2,
      collection_merged_count: 1,
      collected_movie_count: 1,
      post_enrichment_merged_count: 0,
    });
    expect(films).toHaveLength(1);
    expect(films[0]?.imdb_id).toBe("tt12042730");
    expect(films[0]?.showings).toHaveLength(2);
  });

  it("keeps same-title films with different imdb ids apart", async () => {
    const { films, stats } = await collectAndEnrich(context(), {
      providers: [
        provider("one", [film('"Wuthering Heights"', undefined, { imdb_id: "tt32897959" })]),
        provider("two", [film("Wuthering Heights", undefined, { imdb_id: "tt0104181" })]),
      ],
      timer,
    });

    expect(films.map(({ imdb_id }) => imdb_id)).toEqual(["tt32897959", "tt0104181"]);
    expect(stats.collection_merged_count).toBe(0);
  });

  it("reconciles again after enrichment, merging titles TMDb gave one imdb id", async () => {
    const { films, stats, enriched } = await collectAndEnrich(context(), {
      providers: [
        provider("one", [film("Wuthering Heights")]),
        provider("two", [film("Cumbres Borrascosas", "2026-03-29T20:00+01:00")]),
      ],
      previousEnrichment: [
        match("Wuthering Heights", 1, "tt32897959"),
        match("Cumbres Borrascosas", 1, "tt32897959"),
      ],
      tmdbApiKey: "key",
      timer,
    });

    expect(stats).toMatchObject({
      collected_movie_count: 2,
      post_enrichment_merged_count: 1,
      tmdb_cache_hit_count: 2,
      tmdb_enriched_count: 0,
    });
    expect(films).toHaveLength(1);
    expect(films[0]?.showings).toHaveLength(2);
    // Both titles, so either finds its match next time; neither with showings.
    expect(enriched).toEqual([
      expect.objectContaining({ title: "Wuthering Heights", showings: [] }),
      expect.objectContaining({ title: "Cumbres Borrascosas", showings: [] }),
    ]);
  });

  it("skips enrichment without a TMDb key", async () => {
    const warnings: string[] = [];
    const { films, stats, enriched } = await collectAndEnrich(
      context({ log: { ...quiet, warn: (event) => warnings.push(event) } }),
      { providers: [provider("one", [film("Aftersun")])], timer },
    );

    expect(films.map(({ title }) => title)).toEqual(["Aftersun"]);
    expect(stats.tmdb_enriched_count).toBeUndefined();
    expect(enriched).toEqual([]);
    expect(warnings).toContain("tmdb_enrichment_skipped");
  });

  it("reconciles a fallback's films with the fresh ones before enrichment", async () => {
    const { films, stats, providers } = await collectAndEnrich(context(), {
      providers: [provider("verdi", new Error("down")), provider("other", [film("Aftersun")])],
      previousSnapshots: {
        verdi: {
          fetched_at: "2026-03-27T03:00:00Z",
          films: [film("Aftersun", "2026-03-28T21:00+01:00")],
        },
      },
      timer,
    });

    expect(providers.map(({ source }) => source)).toEqual(["fallback", "fresh"]);
    expect(stats).toMatchObject({
      provider_success_count: 1,
      provider_failure_count: 1,
      provider_fallback_count: 1,
      collected_movie_count: 1,
    });
    expect(films[0]?.showings.map(({ starts_at }) => starts_at)).toEqual([
      "2026-03-28T18:00+01:00",
      "2026-03-28T21:00+01:00",
    ]);
  });

  it("counts a provider with zero films as answering", async () => {
    const { stats } = await collectAndEnrich(context(), {
      providers: [
        provider("one", [film("Dune: Part Two")]),
        provider("two", new Error("down")),
        provider("three", []),
      ],
      timer,
    });

    expect(stats).toMatchObject({ provider_success_count: 2, provider_failure_count: 1 });
  });

  it("hands every provider the previous snapshots' films", async () => {
    const seen: string[][] = [];
    const spy: Provider = {
      name: "verdi",
      fetch: (ctx: ProviderContext) => {
        seen.push(ctx.previousFilms.map(({ title }) => title));
        return Promise.resolve({ films: [film("Fresh")] });
      },
    };

    const { snapshots } = await collectAndEnrich(context(), {
      providers: [spy],
      previousSnapshots: {
        verdi: { fetched_at: NOW.toISOString(), films: [film("Old Verdi")] },
        sensacine: { fetched_at: NOW.toISOString(), films: [film("Old SensaCine")] },
      },
      timer,
    });

    expect(seen).toEqual([["Old Verdi", "Old SensaCine"]]);
    // A provider that isn't run this time leaves its snapshot behind.
    expect(Object.keys(snapshots)).toEqual(["verdi"]);
  });
});

describe("collectAndEnrich: the live recording", () => {
  const dir = `${FIXTURES}recorded/live-2026-11-24`;

  it("reproduces Python's reconciled set from the recorded sources", async () => {
    const { now, config } = readReplayCase(dir);
    const registry = parseRegistry(JSON.parse(readFileSync(`${FIXTURES}cinemas.json`, "utf8")));

    const { films, providers } = await collectAndEnrich(
      context({ fetcher: replayFetcher(dir), now, registry }),
      { providers: liveSources.providers.map((build) => build(config)), timer },
    );

    expect(providers.map(({ provider, source }) => [provider, source])).toEqual([
      ["english_cinema_bcn", "none"],
      ["secondary", "none"],
      ["verdi", "fresh"],
      // Empty by design: see the parity test.
      ["sensacine", "none"],
    ]);
    const golden = z
      .array(z.unknown())
      .parse(
        JSON.parse(readFileSync(`${FIXTURES}goldens/live-2026-11-24/reconciled.json`, "utf8")),
      );
    expect(films.map(toCanonicalPython)).toEqual(golden.map(canonicalPython));
  });
});
