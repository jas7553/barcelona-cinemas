import { describe, expect, it } from "vitest";
import {
  collect,
  CollectionError,
  type ProviderSnapshots,
  type RetryPolicy,
  type Timer,
} from "./collect.ts";
import { FetchError, HttpError, NotConfiguredError, PartialFetchError } from "./errors.ts";
import type { Logger, LogFields } from "./log.ts";
import { parseRegistry } from "./registry.ts";
import { ProviderParseError } from "./providers/support.ts";
import type { Provider, ProviderContext, ProviderResult, ScrapedFilm } from "./types.ts";

// 10:00 in Madrid.
const NOW = new Date("2026-03-27T09:00:00Z");
const RETRY: RetryPolicy = { delayMs: 30_000, startDeadlineMs: 55_000 };
const VERDI_URL = "https://barcelona.cines-verdi.com/cartellera";

function film(
  title: string,
  startsAt: readonly string[] = ["2026-03-28T18:00+01:00"],
): ScrapedFilm {
  return {
    title,
    showings: startsAt.map((starts_at) => ({ cinema: "Verdi", starts_at, language: "vo" })),
  };
}

function fakeTimer(): { timer: Timer; sleeps: number[]; advance: (ms: number) => void } {
  let now = 1_000_000;
  const sleeps: number[] = [];
  return {
    sleeps,
    advance: (ms) => {
      now += ms;
    },
    timer: {
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
    },
  };
}

type Outcome = ScrapedFilm[] | ProviderResult | Error;

/** A provider that takes `takesMs` per fetch and plays `outcomes` in order, the last one forever. */
function provider(
  name: string,
  outcomes: readonly Outcome[],
  { takesMs = 0, advance }: { takesMs?: number; advance?: (ms: number) => void } = {},
): Provider & { calls: number } {
  const p = {
    name,
    calls: 0,
    fetch(): Promise<ProviderResult> {
      const outcome = outcomes[Math.min(p.calls, outcomes.length - 1)];
      p.calls += 1;
      advance?.(takesMs);
      if (outcome instanceof Error) return Promise.reject(outcome);
      if (outcome === undefined || Array.isArray(outcome)) {
        return Promise.resolve({ films: outcome ?? [] });
      }
      return Promise.resolve(outcome);
    },
  };
  return p;
}

function captureLog(): { log: Logger; find: (event: string) => LogFields[] } {
  const events: LogFields[] = [];
  const keep = (event: string, fields: LogFields = {}): void => {
    events.push({ event, ...fields });
  };
  return {
    log: { info: keep, warn: keep, error: keep },
    find: (event) => events.filter((e) => e["event"] === event),
  };
}

function context(log: Logger, previousFilms: ScrapedFilm[] = []): ProviderContext {
  return {
    fetcher: { get: () => Promise.reject(new Error("no network in tests")) },
    now: NOW,
    registry: parseRegistry({}),
    log,
    previousFilms,
  };
}

const snapshots = (entries: Readonly<Record<string, [string, ScrapedFilm[]]>>): ProviderSnapshots =>
  Object.fromEntries(
    Object.entries(entries).map(([name, [fetched_at, films]]) => [name, { fetched_at, films }]),
  );

const titles = (films: readonly ScrapedFilm[]): string[] => films.map(({ title }) => title).sort();

async function run(
  providers: readonly Provider[],
  {
    previous,
    clock = fakeTimer(),
  }: { previous?: ProviderSnapshots; clock?: ReturnType<typeof fakeTimer> } = {},
) {
  const { log, find } = captureLog();
  const collection = await collect(providers, context(log), {
    retry: RETRY,
    timer: clock.timer,
    ...(previous && { previousSnapshots: previous }),
  });
  return { ...collection, find, sleeps: clock.sleeps };
}

const timeout = (): FetchError => new FetchError("timeout", VERDI_URL);
const healthy = (): Provider => provider("other", [[film("Dune: Part Two")]]);

describe("collect: retry", () => {
  it("retries a transient failure once, after the delay, and the retry's films count", async () => {
    const clock = fakeTimer();
    const verdi = provider("verdi", [timeout(), [film("Valid Film")]], {
      takesMs: 15_000,
      advance: clock.advance,
    });

    const { films, providers, find, sleeps } = await run([verdi], { clock });

    expect(titles(films)).toEqual(["Valid Film"]);
    expect(sleeps).toEqual([RETRY.delayMs]);
    expect(providers[0]).toMatchObject({ source: "fresh", attempts: 2 });
    expect(providers[0]?.failure).toBeUndefined();
    expect(find("provider_retry")[0]).toMatchObject({
      attempt: 1,
      exception_type: "FetchError",
      elapsed_ms: 15_000,
      host: "barcelona.cines-verdi.com",
    });
    expect(find("collection_failure")).toEqual([]);
  });

  it("fails a provider still failing after its retry", async () => {
    const clock = fakeTimer();
    const verdi = provider("verdi", [new HttpError(403, VERDI_URL)], {
      takesMs: 1000,
      advance: clock.advance,
    });

    const { providers, find } = await run([verdi, healthy()], { clock });

    expect(verdi.calls).toBe(2);
    expect(providers[0]?.failure).toMatchObject({ outcome: "retry_failed", http_status: 403 });
    expect(find("collection_failure")).toEqual([
      expect.objectContaining({ attempt: 2, http_status: 403, total_elapsed_ms: 32_000 }),
    ]);
  });

  it.each([
    ["a parse error", new ProviderParseError("bad markup")],
    ["a 404", new HttpError(404, VERDI_URL)],
  ])("doesn't retry %s", async (_, error) => {
    const verdi = provider("verdi", [error]);

    const { providers, sleeps, find } = await run([verdi, healthy()]);

    expect(verdi.calls).toBe(1);
    expect(sleeps).toEqual([]);
    expect(providers[0]?.failure?.outcome).toBe("not_retryable");
    expect(find("provider_retry")).toEqual([]);
  });

  it("doesn't retry a provider that isn't configured", async () => {
    const feed = provider("english_cinema_bcn", [
      new NotConfiguredError("LISTINGS_FEED_URL is not set"),
    ]);

    const { providers, sleeps } = await run([feed, healthy()]);

    expect(sleeps).toEqual([]);
    expect(providers[0]).toMatchObject({
      source: "none",
      failure: { outcome: "not_configured", error: "LISTINGS_FEED_URL is not set" },
    });
  });

  it("skips a retry that would start past the deadline", async () => {
    const clock = fakeTimer();
    const late = RETRY.startDeadlineMs - RETRY.delayMs + 1;
    const verdi = provider("verdi", [timeout(), [film("Never Fetched")]], {
      takesMs: late,
      advance: clock.advance,
    });

    const { films, providers, sleeps } = await run([verdi, healthy()], { clock });

    expect(titles(films)).toEqual(["Dune: Part Two"]);
    expect(sleeps).toEqual([]);
    expect(providers[0]?.failure?.outcome).toBe("over_budget");
  });

  it("retries a failure just inside the deadline", async () => {
    const clock = fakeTimer();
    const onTime = RETRY.startDeadlineMs - RETRY.delayMs;
    const verdi = provider("secondary", [timeout(), [film("Valid Film")]], {
      takesMs: onTime,
      advance: clock.advance,
    });

    const { films } = await run([verdi], { clock });

    expect(titles(films)).toEqual(["Valid Film"]);
  });

  it("retries zero films, logging the entry page that came back", async () => {
    const challenge: ProviderResult = {
      films: [],
      entry: {
        url: "https://www.moobycinemas.com/cartelera",
        status: 200,
        contentType: "text/html",
        text: `<html>\n  <title>Just a moment...</title>\n${"x".repeat(1000)}`,
      },
    };
    const secondary = provider("secondary", [challenge, [film("Valid Film")]]);

    const { films, sleeps, find } = await run([secondary]);

    expect(titles(films)).toEqual(["Valid Film"]);
    expect(sleeps).toEqual([RETRY.delayMs]);
    expect(find("provider_zero_result")).toEqual([]);
    const [retry] = find("provider_retry");
    expect(retry).toMatchObject({
      reason: "zero_result",
      http_status: 200,
      host: "www.moobycinemas.com",
      body_bytes: 1041,
    });
    expect(String(retry?.["body_head"])).toMatch(/^<html> <title>Just a moment\.\.\.<\/title> xxx/);
    expect(String(retry?.["body_head"])).toHaveLength(300);
  });

  it("logs the entry page when zero films survive the retry", async () => {
    const empty: ProviderResult = {
      films: [],
      entry: { url: VERDI_URL, status: 200, contentType: "text/html", text: "<html></html>" },
    };
    const verdi = provider("verdi", [empty]);

    const { find } = await run([verdi, healthy()]);

    expect(verdi.calls).toBe(2);
    expect(find("provider_zero_result")).toEqual([
      expect.objectContaining({ provider: "verdi", http_status: 200 }),
    ]);
  });

  it("doesn't retry zero films past the deadline", async () => {
    const clock = fakeTimer();
    const late = RETRY.startDeadlineMs - RETRY.delayMs + 1;
    const secondary = provider("secondary", [[], [film("Never Fetched")]], {
      takesMs: late,
      advance: clock.advance,
    });

    const { sleeps, find } = await run([secondary, healthy()], { clock });

    expect(sleeps).toEqual([]);
    expect(find("provider_zero_result")).toHaveLength(1);
  });
});

describe("collect: snapshot fallback", () => {
  it("snapshots a provider's fresh films at now", async () => {
    const movie = film("Dune: Part Two");

    const { snapshots: out } = await run([provider("verdi", [[movie]])]);

    expect(out).toEqual({ verdi: { fetched_at: NOW.toISOString(), films: [movie] } });
  });

  it("needs no fallback after a successful retry", async () => {
    const verdi = provider("verdi", [timeout(), [film("Fresh")]]);
    const previous = snapshots({ verdi: [NOW.toISOString(), [film("Snapshot")]] });

    const { films, providers, find } = await run([verdi], { previous });

    expect(titles(films)).toEqual(["Fresh"]);
    expect(providers[0]?.source).toBe("fresh");
    expect(find("provider_fallback")).toEqual([]);
  });

  it("falls back to the last good snapshot after the retry is spent, and carries it unchanged", async () => {
    const snapshotFilms = [film("Aftersun")];
    const previous = snapshots({ verdi: ["2026-03-26T21:00:00+00:00", snapshotFilms] });

    const {
      films,
      providers,
      snapshots: out,
      sleeps,
      find,
    } = await run([provider("verdi", [timeout()]), healthy()], { previous });

    expect(sleeps).toEqual([RETRY.delayMs]);
    expect(titles(films)).toEqual(["Aftersun", "Dune: Part Two"]);
    expect(providers[0]).toMatchObject({
      source: "fallback",
      failure: { outcome: "retry_failed" },
      fallback: { used: true, snapshot_age_hours: 12 },
    });
    expect(find("collection_failure")[0]).toMatchObject({ provider: "verdi" });
    expect(find("provider_fallback")[0]).toMatchObject({
      provider: "verdi",
      trigger: "failure",
      snapshot_age_hours: 12,
      showtime_count: 1,
    });
    expect(out).toHaveProperty("verdi", {
      fetched_at: "2026-03-26T21:00:00+00:00",
      films: snapshotFilms,
    });
  });

  it("falls back when too much of a fetch was lost, after retrying it", async () => {
    const lost = new PartialFetchError("verdi lost 3 of 4 showtimes without a sala");
    const verdi = provider("verdi", [lost]);
    const previous = snapshots({ verdi: [NOW.toISOString(), [film("Aftersun")]] });

    const { films, providers, find } = await run([verdi, healthy()], { previous });

    expect(verdi.calls).toBe(2);
    expect(titles(films)).toContain("Aftersun");
    expect(providers[0]?.source).toBe("fallback");
    expect(find("collection_failure")[0]).toMatchObject({ exception_type: "PartialFetchError" });
  });

  it("leaves out a failed provider without a snapshot, and doesn't snapshot it", async () => {
    const previous = snapshots({ other: [NOW.toISOString(), [film("Unrelated")]] });

    const {
      films,
      providers,
      snapshots: out,
      find,
    } = await run([provider("verdi", [new Error("down")]), healthy()], { previous });

    expect(titles(films)).toEqual(["Dune: Part Two"]);
    expect(providers[0]).toMatchObject({
      source: "none",
      fallback: { used: false, reason: "no_snapshot" },
    });
    expect(find("provider_fallback_unavailable")[0]).toMatchObject({
      provider: "verdi",
      reason: "no_snapshot",
    });
    expect(out).not.toHaveProperty("verdi");
  });

  it("rejects and forgets a snapshot older than 24 hours", async () => {
    const staleAt = new Date(NOW.getTime() - 24 * 3_600_000 - 60_000).toISOString();
    const previous = snapshots({ verdi: [staleAt, [film("Aftersun")]] });

    const {
      films,
      providers,
      snapshots: out,
      find,
    } = await run([provider("verdi", [new Error("down")]), healthy()], { previous });

    expect(titles(films)).toEqual(["Dune: Part Two"]);
    expect(providers[0]?.fallback).toEqual({
      used: false,
      reason: "stale",
      snapshot_age_hours: 24,
    });
    expect(find("provider_fallback_unavailable")[0]).toMatchObject({ reason: "stale" });
    expect(find("provider_fallback")).toEqual([]);
    expect(out).not.toHaveProperty("verdi");
  });

  it("uses a snapshot exactly 24 hours old", async () => {
    const previous = snapshots({
      verdi: [new Date(NOW.getTime() - 24 * 3_600_000).toISOString(), [film("Aftersun")]],
    });

    const { providers } = await run([provider("verdi", [new Error("down")]), healthy()], {
      previous,
    });

    expect(providers[0]?.source).toBe("fallback");
  });

  it("treats a snapshot with an unreadable fetched_at as stale", async () => {
    const previous = snapshots({ verdi: ["yesterday", [film("Aftersun")]] });

    const { providers } = await run([provider("verdi", [new Error("down")]), healthy()], {
      previous,
    });

    expect(providers[0]?.fallback).toEqual({ used: false, reason: "stale" });
  });

  it("drops the snapshot's showings that have started, keeping one starting this minute", async () => {
    const aftersun = film("Aftersun", [
      "2026-03-26T22:00+01:00", // yesterday
      "2026-03-27T09:59+01:00", // earlier today
      "2026-03-27T10:00+01:00", // starting now
      "2026-03-28T08:00+01:00",
    ]);
    const over = film("Over", ["2026-03-26T22:00+01:00"]);
    const previous = snapshots({ verdi: ["2026-03-26T21:00:00+00:00", [aftersun, over]] });
    const clockAt = new Date("2026-03-27T09:00:30Z");
    const { log, find } = captureLog();

    const { films } = await collect(
      [provider("verdi", [new Error("down")]), healthy()],
      { ...context(log), now: clockAt },
      { previousSnapshots: previous, retry: RETRY, timer: fakeTimer().timer },
    );

    expect(titles(films)).toEqual(["Aftersun", "Dune: Part Two"]);
    expect(
      films.find(({ title }) => title === "Aftersun")?.showings.map((s) => s.starts_at),
    ).toEqual(["2026-03-27T10:00+01:00", "2026-03-28T08:00+01:00"]);
    expect(find("provider_fallback")[0]).toMatchObject({ past_showtime_dropped_count: 3 });
  });

  it("falls back on zero films and keeps the snapshot: a bot-challenge page parses to nothing", async () => {
    const snapshotFilms = [film("Aftersun")];
    const previous = snapshots({ verdi: ["2026-03-26T21:00:00+00:00", snapshotFilms] });

    const {
      films,
      providers,
      snapshots: out,
      find,
    } = await run([provider("verdi", [[]]), healthy()], { previous });

    expect(titles(films)).toEqual(["Aftersun", "Dune: Part Two"]);
    expect(providers[0]).toMatchObject({ source: "fallback", attempts: 2 });
    expect(providers[0]?.failure).toBeUndefined();
    expect(find("provider_zero_result")).toHaveLength(1);
    expect(find("provider_fallback")[0]).toMatchObject({ trigger: "zero_result" });
    expect(out).toHaveProperty("verdi", {
      fetched_at: "2026-03-26T21:00:00+00:00",
      films: snapshotFilms,
    });
  });

  it("never writes an empty snapshot", async () => {
    const { snapshots: out, find } = await run([provider("verdi", [[]]), healthy()]);

    expect(out).not.toHaveProperty("verdi");
    expect(find("provider_fallback_unavailable")[0]).toMatchObject({
      provider: "verdi",
      trigger: "zero_result",
      reason: "no_snapshot",
    });
  });
});

describe("collect: the run as a whole", () => {
  it.each([
    ["an error status", new HttpError(403, "https://feed.private.test/s3cret/films"), "HTTP 403"],
    [
      "no response",
      new FetchError("timeout", "https://feed.private.test/s3cret/films"),
      "timed out",
    ],
  ])("logs %s from a source with secret URLs without its URL", async (_, error, message) => {
    const feed = { ...provider("english_cinema_bcn", [error]), secretUrls: true };

    const { providers, find } = await run([feed, healthy()]);

    const logged = JSON.stringify([providers, find("provider_retry"), find("collection_failure")]);
    expect(logged).not.toContain("feed.private.test");
    expect(logged).not.toContain("s3cret");
    expect(providers[0]?.failure).toMatchObject({ outcome: "retry_failed", error: message });
  });

  it("logs a zero-result entry page from a source with secret URLs without its host", async () => {
    const empty: ProviderResult = {
      films: [],
      entry: {
        url: "https://feed.private.test/s3cret/films",
        status: 200,
        contentType: "text/html",
        text: "<html></html>",
      },
    };
    const feed = { ...provider("english_cinema_bcn", [empty]), secretUrls: true };

    const { find } = await run([feed, healthy()]);

    const logged = JSON.stringify([find("provider_retry"), find("provider_zero_result")]);
    expect(find("provider_zero_result")).toEqual([
      expect.objectContaining({ provider: "english_cinema_bcn", http_status: 200 }),
    ]);
    expect(logged).not.toContain("feed.private.test");
  });

  it("validates each provider's films before they are used or stored", async () => {
    const bad: ScrapedFilm = {
      title: "Hamnet",
      imdb_id: "imdb-1",
      showings: [
        {
          cinema: "Verdi",
          starts_at: "2026-03-28T18:00+01:00",
          language: "vo",
          booking_url: "null",
        },
      ],
    };
    const want = { title: "Hamnet", showings: [film("Hamnet").showings[0]] };

    const { films, snapshots: stored, find } = await run([provider("sensacine", [[bad]])]);

    expect(films).toEqual([want]);
    expect(stored["sensacine"]?.films).toEqual([want]);
    expect(find("provider_output_discarded")).toEqual([
      expect.objectContaining({
        provider: "sensacine",
        discarded: { "booking_url: not an http(s) URL": 1, "imdb_id: not an IMDb title id": 1 },
      }),
    ]);
  });

  it("keeps provider order whichever answers first", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: Provider = {
      name: "one",
      fetch: async () => {
        await gate;
        return { films: [film("From Provider One")] };
      },
    };
    const fast: Provider = {
      name: "two",
      fetch: () => {
        release?.();
        return Promise.resolve({ films: [film("From Provider Two")] });
      },
    };

    const { films } = await run([slow, fast]);

    expect(films.map(({ title }) => title)).toEqual(["From Provider One", "From Provider Two"]);
  });

  it("throws when every provider fails, whatever the snapshots hold", async () => {
    const previous = snapshots({ verdi: [NOW.toISOString(), [film("Aftersun")]] });

    const attempt = run([provider("verdi", [new Error("down")])], { previous });

    await expect(attempt).rejects.toThrow(CollectionError);
    await expect(attempt).rejects.toThrow("All providers failed");
  });

  it("throws when the providers answer but only snapshots have films", async () => {
    const previous = snapshots({ verdi: [NOW.toISOString(), [film("Aftersun")]] });

    await expect(run([provider("verdi", [[]])], { previous })).rejects.toThrow(
      "none returned films",
    );
  });

  it("reports every provider when it throws", async () => {
    const error = await run([provider("verdi", [new Error("down")]), provider("two", [[]])]).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(CollectionError);
    expect(error instanceof CollectionError && error.providers.map((p) => p.source)).toEqual([
      "none",
      "none",
    ]);
  });
});
