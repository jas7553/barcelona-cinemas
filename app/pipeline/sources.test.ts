import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HttpError } from "./errors.ts";
import { getOk } from "./http.ts";
import type { Logger } from "./log.ts";
import { replayFetcher } from "./recordings.ts";
import { parseRegistry } from "./registry.ts";
import {
  readReplayCase,
  recordSources,
  sourceConfigFromEnv,
  type LiveSources,
  type SourceConfig,
} from "./sources.ts";
import type { Provider, ProviderContext, ProviderResult } from "./types.ts";

describe("sourceConfigFromEnv", () => {
  it("reads each source's variable and lists the unset ones", () => {
    expect(
      sourceConfigFromEnv({
        LISTINGS_FEED_URL: " https://feed.test/ ",
        SECONDARY_LISTINGS_URL: "  ",
        TMDB_API_KEY: "k",
      }),
    ).toEqual({
      config: { listingsFeedUrl: "https://feed.test/", tmdbApiKey: "k" },
      missing: ["SECONDARY_LISTINGS_URL"],
    });
  });
});

describe("recordSources", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      if (req.url === SECRET_PATH) {
        // The feed links its films absolutely and root-relatively, and names itself.
        res.end(`<link rel="canonical" href="${base}${SECRET_PATH}">
          <a href="${base}/m/1">1</a> <a href="/m/2">2</a>`);
        return;
      }
      res.end(`<h1>${req.url ?? ""}</h1>`);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  const log = () =>
    ({
      info: vi.fn<Logger["info"]>(),
      warn: vi.fn<Logger["warn"]>(),
      error: vi.fn<Logger["error"]>(),
    }) satisfies Logger;
  const now = new Date("2026-11-24T10:00:00Z");
  const registry = parseRegistry({});

  const fakeProvider = (key: string): Provider => ({
    name: "fake",
    async fetch(ctx: ProviderContext): Promise<ProviderResult> {
      const feed = await getOk(ctx.fetcher, `${base}/feed?api_key=${key}`, { timeoutMs: 2000 });
      const film = await getOk(ctx.fetcher, `${base}/film/1`, { timeoutMs: 2000 });
      return { films: [{ title: film.text, showings: [] }], entry: { ...feed } };
    },
  });

  it("writes a recording the replay fetcher reads back, without the key", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "record-"));
    const enrich = vi.fn<NonNullable<LiveSources["enrich"]>>(async (films, ctx) => {
      await ctx.fetcher.get(`${base}/tmdb?query=${films[0]?.title ?? ""}`, { timeoutMs: 2000 });
    });
    const sources: LiveSources = {
      providers: [(config) => fakeProvider(config.tmdbApiKey ?? "")],
      enrich,
    };

    const failed = await recordSources(
      sources,
      { tmdbApiKey: "s3cret" },
      { outDir, now, registry, log: log() },
    );

    expect(failed).toEqual([]);
    expect(enrich).toHaveBeenCalledOnce();
    const manifest = readFileSync(join(outDir, "manifest.json"), "utf8");
    expect(manifest).not.toContain("s3cret");

    const replayed = await fakeProvider("another-key").fetch({
      fetcher: replayFetcher(outDir),
      now,
      registry,
      log: log(),
      previousFilms: [],
    });
    expect(replayed.films).toEqual([{ title: "<h1>/film/1</h1>", showings: [] }]);
    await expect(
      replayFetcher(outDir).get(`${base}/tmdb?query=<h1>/film/1</h1>`, { timeoutMs: 1 }),
    ).resolves.toMatchObject({ status: 200 });
  });

  const SECRET_PATH = "/s3cret-feed-token/films";

  /** Reads the feed at the configured URL, then every film page it links to. */
  const feedProvider = (config: SourceConfig): Provider => ({
    name: "feed",
    secretUrls: true,
    async fetch(ctx) {
      const feed = await getOk(ctx.fetcher, config.listingsFeedUrl ?? "", { timeoutMs: 2000 });
      const films = [];
      for (const [, href = ""] of feed.text.matchAll(/<a href="([^"]+)"/g)) {
        const page = await getOk(ctx.fetcher, new URL(href, feed.url).href, { timeoutMs: 2000 });
        films.push({ title: page.text, showings: [] });
      }
      return { films };
    },
  });

  it("stores secret URLs as stand-ins, and replays with them", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "record-"));
    const secret = `${base}${SECRET_PATH}`;

    const failed = await recordSources(
      { providers: [feedProvider] },
      { listingsFeedUrl: secret },
      { outDir, now, registry, log: log() },
    );

    expect(failed).toEqual([]);
    const host = new URL(base).host;
    for (const file of readdirSync(outDir)) {
      const written = `${file}\n${readFileSync(join(outDir, file), "utf8")}`;
      expect(written).not.toContain(secret);
      expect(written).not.toContain("s3cret-feed-token");
      expect(written).not.toContain(host);
    }
    const { config } = readReplayCase(outDir);
    expect(config.listingsFeedUrl).toMatch(/^https:\/\/listings-feed\.example\.test\//);
    const replayed = await feedProvider(config).fetch({
      fetcher: replayFetcher(outDir),
      now,
      registry,
      log: log(),
      previousFilms: [],
    });
    expect(replayed.films.map(({ title }) => title)).toEqual(["<h1>/m/1</h1>", "<h1>/m/2</h1>"]);
  });

  it("logs a secret source's failure without its URL", async () => {
    const logger = log();
    const secret = "https://feed.private.test/s3cret-feed-token/films";
    const failing: Provider = {
      name: "feed",
      secretUrls: true,
      fetch: () => Promise.reject(new HttpError(403, secret)),
    };

    await recordSources(
      { providers: [() => failing] },
      { listingsFeedUrl: secret },
      { outDir: mkdtempSync(join(tmpdir(), "record-")), now, registry, log: logger },
    );

    expect(logger.error).toHaveBeenCalledWith("record_provider_failed", {
      provider: "feed",
      error: "HttpError: HTTP 403",
    });
  });

  it("records the rest when a source fails", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "record-"));
    const logger = log();
    const broken: Provider = {
      name: "broken",
      fetch: () => Promise.reject(new Error("markup changed")),
    };
    const sources: LiveSources = {
      providers: [
        () => broken,
        () => {
          throw new Error("LISTINGS_FEED_URL is not set");
        },
        () => fakeProvider("k"),
      ],
    };

    const failed = await recordSources(sources, {}, { outDir, now, registry, log: logger });

    expect(failed).toEqual(["broken", "(unbuilt provider)"]);
    expect(logger.error).toHaveBeenCalledWith("record_provider_failed", {
      provider: "broken",
      error: "Error: markup changed",
    });
    expect(JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"))).toHaveLength(2);
  });
});
