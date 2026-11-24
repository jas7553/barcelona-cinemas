import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { FetchError } from "./errors.ts";
import type { Fetcher, FetchResponse } from "./http.ts";
import type { Logger, LogFields } from "./log.ts";
import { reconcile } from "./reconcile.ts";
import { replayFetcher, stripCredentials } from "./recordings.ts";
import { parseRegistry } from "./registry.ts";
import { liveSources } from "./sources.ts";
import {
  canonicalPython,
  previousFromPython,
  scrapedFromPython,
  toCanonicalPython,
} from "./testing/python-enriched.ts";
import { enrich, TMDB_MATCH_VERSION, type EnrichedFilm, type PreviousEnrichment } from "./tmdb.ts";
import type { PipelineContext, ScrapedFilm } from "./types.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const registry = parseRegistry({});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, FIXTURES), "utf8"));
}

function captureLog(): { log: Logger; events: LogFields[]; warnings: LogFields[] } {
  const events: LogFields[] = [];
  const warnings: LogFields[] = [];
  const log: Logger = {
    info: (event, fields = {}) => events.push({ event, ...fields }),
    warn: (event, fields = {}) => warnings.push({ event, ...fields }),
    error: vi.fn(),
  };
  return { log, events, warnings };
}

/** `inner`, keeping each URL asked for, without the API key. */
function tracking(inner: Fetcher): { fetcher: Fetcher; requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    fetcher: {
      get(url, options) {
        requests.push(stripCredentials(url));
        return inner.get(url, options);
      },
    },
  };
}

interface TmdbCase {
  now: string;
  movies: unknown[];
  cached?: unknown[];
  reconcileFirst?: boolean;
}

interface TmdbGolden {
  collected: unknown[] | null;
  enriched: unknown[];
  reconciled: unknown[];
  stats: unknown;
  requests: string[];
  events: LogFields[];
}

type Match = Record<"title" | "tmdb_id" | "english_title" | "imdb_id" | "year", unknown>;

function match(film: EnrichedFilm): Match {
  return {
    title: film.title,
    tmdb_id: film.tmdb_id ?? null,
    english_title: film.english_title ?? null,
    imdb_id: film.imdb_id ?? null,
    year: film.year ?? null,
  };
}

describe("TMDb enrichment parity with Python", () => {
  const cases = readdirSync(new URL("recorded/inline/tmdb/", FIXTURES)).sort();
  const matches = readJson("goldens/inline/tmdb-matches.json") as Record<string, Match[]>;

  it("has a golden for every recorded case, and a case for every golden", () => {
    const goldens = readdirSync(new URL("goldens/inline/tmdb/", FIXTURES))
      .map((file) => file.replace(/\.json$/, ""))
      .sort();
    expect(cases).toEqual(goldens);
    expect(Object.keys(matches).sort()).toEqual(cases);
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("%s", async (name) => {
    const dir = `recorded/inline/tmdb/${name}/`;
    const input = readJson(`${dir}case.json`) as TmdbCase;
    const golden = readJson(`goldens/inline/tmdb/${name}.json`) as TmdbGolden;
    const { fetcher, requests } = tracking(replayFetcher(fileURLToPath(new URL(dir, FIXTURES))));
    // Python's warnings are plain log lines the goldens don't hold; its structured events are info.
    const { log, events } = captureLog();
    const ctx: PipelineContext = { fetcher, now: new Date(input.now), registry, log };

    let films = input.movies.map(scrapedFromPython);
    if (input.reconcileFirst) {
      films = reconcile(films, { stage: "collection", log });
      expect(films.map(toCanonicalPython)).toEqual(golden.collected?.map(canonicalPython));
    } else {
      expect(golden.collected).toBeNull();
    }
    const result = await enrich(films, ctx, {
      apiKey: "parity-test-key",
      previous: (input.cached ?? []).map(previousFromPython),
      // The goldens were made with Python's HTTP session replaced under its retry adapter.
      retry: { delaysMs: [] },
    });
    const reconciled = reconcile(result.films, { stage: "post_enrichment", log });

    expect(requests).toEqual(golden.requests);
    expect(result.films.map(toCanonicalPython)).toEqual(golden.enriched.map(canonicalPython));
    expect(reconciled.map(toCanonicalPython)).toEqual(golden.reconciled.map(canonicalPython));
    expect(result.stats).toEqual(golden.stats);
    expect(events).toEqual(golden.events);
    expect(result.films.map(match)).toEqual(matches[name]);
  });
});

const NOW = new Date("2026-10-20T08:00:00Z");

interface Route {
  status: number;
  body?: unknown;
}

/** Answers by path (`/search/movie?query=…` keeps its query); each route's responses in turn. */
function fakeTmdb(routes: Record<string, (Route | "no response")[]>): Fetcher & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    get(url) {
      urls.push(url);
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query");
      const key = parsed.pathname.replace("/3", "") + (query === null ? "" : `?query=${query}`);
      const queue = routes[key] ?? [];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next === undefined)
        return Promise.resolve({ url, status: 404, contentType: "", text: "{}" });
      if (next === "no response") return Promise.reject(new FetchError("timeout", url));
      const response: FetchResponse = {
        url,
        status: next.status,
        contentType: "application/json",
        text: JSON.stringify(next.body ?? {}),
      };
      return Promise.resolve(response);
    },
  };
}

const ok = (body: unknown): Route => ({ status: 200, body });
const listing = (title: string): ScrapedFilm => ({ title, showings: [] });
const DUNE_ROUTES = {
  "/search/movie?query=Dune": [ok({ results: [{ id: 7, title: "Dune", genre_ids: [] }] })],
  "/movie/7": [ok({ id: 7, title: "Dune", original_language: " FR " })],
};

function context(fetcher: Fetcher, log = captureLog().log): PipelineContext {
  return { fetcher, now: NOW, registry, log };
}

describe("enrich", () => {
  it("retries a 5xx or no response twice, waiting as urllib3 would", async () => {
    const fetcher = fakeTmdb({
      ...DUNE_ROUTES,
      "/search/movie?query=Dune": [
        { status: 503 },
        "no response",
        ...DUNE_ROUTES["/search/movie?query=Dune"],
      ],
    });
    const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());

    const { films, stats } = await enrich([listing("Dune")], context(fetcher), {
      apiKey: "k",
      retry: { delaysMs: [0, 2000], sleep },
    });

    expect(sleep.mock.calls).toEqual([[0], [2000]]);
    expect(films[0]?.tmdb_id).toBe(7);
    expect(stats.tmdb_failure_count).toBe(0);
  });

  it("fails the lookup once retries run out, and never retries a 4xx", async () => {
    const down = fakeTmdb({ "/search/movie?query=Dune": [{ status: 500 }] });
    const sleep = vi.fn(() => Promise.resolve());
    const { log, warnings } = captureLog();

    const { films, stats } = await enrich([listing("Dune")], context(down, log), {
      apiKey: "secret",
      retry: { delaysMs: [0, 2000], sleep },
    });

    expect(down.urls).toHaveLength(3);
    expect(films).toEqual([listing("Dune")]);
    expect(stats.tmdb_failure_count).toBe(1);
    expect(warnings).toEqual([{ event: "tmdb_lookup_failed", title: "Dune", error: "HTTP 500" }]);
    expect(JSON.stringify(warnings)).not.toContain("secret");

    const missing = fakeTmdb({ "/search/movie?query=Dune": [{ status: 404 }] });
    await enrich([listing("Dune")], context(missing), {
      apiKey: "k",
      retry: { delaysMs: [0], sleep },
    });
    expect(missing.urls).toHaveLength(1);
  });

  it("sends the API key, and stamps the match with the refresh's instant", async () => {
    const fetcher = fakeTmdb(DUNE_ROUTES);
    const { films } = await enrich([listing("Dune")], context(fetcher), { apiKey: "k3y" });

    expect(fetcher.urls.every((url) => new URL(url).searchParams.get("api_key") === "k3y")).toBe(
      true,
    );
    expect(films[0]).toMatchObject({
      enriched_at: NOW.toISOString(),
      tmdb_match_version: TMDB_MATCH_VERSION,
      original_lang: "fr",
    });
  });

  it("treats a JSON body that isn't an object as a failed lookup", async () => {
    const fetcher = fakeTmdb({ "/search/movie?query=Dune": [ok(["not", "an", "object"])] });
    const { stats } = await enrich([listing("Dune")], context(fetcher), { apiKey: "k" });
    expect(stats.tmdb_failure_count).toBe(1);
  });

  describe("reusing a previous match", () => {
    const previous = (enriched_at: string): PreviousEnrichment => ({
      title: "Dune",
      tmdb_id: 7,
      enriched_at,
      tmdb_match_version: TMDB_MATCH_VERSION,
    });

    it.each([
      ["exactly the TTL ago", "2026-10-13T08:00:00Z", 0],
      ["an offset-less instant, read as UTC", "2026-10-13T08:00:00", 0],
      ["a millisecond past the TTL", "2026-10-13T07:59:59.999Z", 1],
      ["an unreadable instant", "last week", 1],
    ])("%s", async (_, enrichedAt, lookups) => {
      const fetcher = fakeTmdb(DUNE_ROUTES);
      const { stats } = await enrich([listing("Dune")], context(fetcher), {
        apiKey: "k",
        previous: [previous(enrichedAt)],
      });
      expect(stats.tmdb_reenriched_count).toBe(lookups);
      expect(stats.tmdb_cache_hit_count).toBe(1 - lookups);
    });

    it("honours a shorter TTL", async () => {
      const fetcher = fakeTmdb(DUNE_ROUTES);
      const { stats } = await enrich([listing("Dune")], context(fetcher), {
        apiKey: "k",
        previous: [previous("2026-10-19T08:00:00Z")],
        ttlDays: 0.5,
      });
      expect(stats.tmdb_reenriched_count).toBe(1);
    });
  });
});

describe("liveSources.enrich", () => {
  it("leaves the films as they are without an API key", async () => {
    const fetcher = fakeTmdb(DUNE_ROUTES);
    const { log, warnings } = captureLog();
    const films = [listing("Dune")];

    await expect(liveSources.enrich?.(films, context(fetcher, log), {})).resolves.toBe(films);

    expect(fetcher.urls).toEqual([]);
    expect(warnings).toEqual([{ event: "tmdb_enrichment_skipped", reason: "no TMDB_API_KEY" }]);
  });

  it("enriches with the configured key", async () => {
    const fetcher = fakeTmdb(DUNE_ROUTES);
    await liveSources.enrich?.([listing("Dune")], context(fetcher), { tmdbApiKey: "k" });
    expect(fetcher.urls.length).toBeGreaterThan(0);
  });
});
