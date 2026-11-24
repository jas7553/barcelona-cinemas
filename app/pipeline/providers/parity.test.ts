/**
 * Output parity with the legacy Python providers: every recording under `fixtures/recorded` is
 * replayed through the TS provider, projected to the Python shape and compared with the golden
 * Python produced from the same recording, requests and failure included.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HttpError, PartialFetchError } from "../errors.ts";
import type { Fetcher } from "../http.ts";
import type { Logger } from "../log.ts";
import { replayFetcher, UnrecordedRequestError } from "../recordings.ts";
import { parseRegistry } from "../registry.ts";
import { pythonReconcile, toPythonFilms } from "../testing/python-shape.ts";
import type { Provider, ScrapedFilm } from "../types.ts";
import { englishCinemaBcnProvider } from "./englishCinemaBcn.ts";
import { secondaryProvider } from "./secondary.ts";
import { sensacineProvider } from "./sensacine.ts";
import { ProviderParseError } from "./support.ts";
import { verdiProvider } from "./verdi.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const registry = parseRegistry(JSON.parse(readFileSync(join(FIXTURES, "cinemas.json"), "utf8")));

const Case = z.looseObject({
  now: z.string(),
  config: z
    .looseObject({
      listingsFeedUrl: z.string().optional(),
      secondaryListingsUrl: z.string().optional(),
    })
    .optional(),
  sensacine: z.object({ ids: z.record(z.string(), z.string()), daysAhead: z.number() }).optional(),
  verdi: z.object({ slugs: z.array(z.string()) }).optional(),
  salaMap: z.record(z.string(), z.string()).optional(),
});
type Case = z.infer<typeof Case>;

const Golden = z.object({
  result: z.array(z.unknown()).nullable(),
  error: z.object({ type: z.string(), message: z.string() }).nullable(),
  requests: z.array(z.string()),
  events: z.array(z.unknown()),
});

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const PROVIDER_KINDS = ["english_cinema_bcn", "secondary", "sensacine", "verdi"] as const;
type Kind = (typeof PROVIDER_KINDS)[number];
/** Recordings other modules' parity tests own. */
const OTHER_KINDS = ["reconcile", "tmdb", "tmdb-rank"];

function build(kind: Kind, spec: Case): Provider {
  switch (kind) {
    case "english_cinema_bcn":
      return englishCinemaBcnProvider({ feedUrl: spec.config?.listingsFeedUrl });
    case "secondary":
      return secondaryProvider({ listingsUrl: spec.config?.secondaryListingsUrl });
    case "sensacine":
      return sensacineProvider(spec.sensacine);
    case "verdi":
      return verdiProvider(spec.verdi);
  }
}

/** The cached sala map as the previous refresh's films, which is where the TS provider reads it. */
function previousFilmsFor(salaMap: Readonly<Record<string, string>>): ScrapedFilm[] {
  return [
    {
      title: "cached",
      showings: Object.entries(salaMap).map(([id, cinema]) => ({
        cinema,
        starts_at: "2026-01-01T00:00+01:00",
        language: "vo",
        booking_url: `https://verdibcn.admit-one.eu/seats/${id}/`,
      })),
    },
  ];
}

/** Python's exception names, as the TS errors that stand for them. */
const ERROR_KINDS: Record<string, new (...args: never[]) => Error> = {
  HTTPError: HttpError,
  RuntimeError: ProviderParseError,
  PartialFetchError,
};

interface Run {
  films: ScrapedFilm[] | undefined;
  error: unknown;
  requests: string[];
  gaps: string[];
  events: unknown[];
}

async function run(kind: Kind, dir: string): Promise<Run> {
  const spec = Case.parse(readJson(join(dir, "case.json")));
  const replay = replayFetcher(dir);
  const requests: string[] = [];
  const gaps: string[] = [];
  const fetcher: Fetcher = {
    async get(url, options) {
      requests.push(url);
      try {
        return await replay.get(url, options);
      } catch (error) {
        if (error instanceof UnrecordedRequestError) gaps.push(url);
        throw error;
      }
    },
  };
  // Python's goldens hold only `log_event` events; the providers' own warnings have other names here.
  const events: unknown[] = [];
  const record = (event: string, fields: object = {}): void => {
    if (event === "provider_partial_failure") events.push({ event, ...fields });
  };
  const log: Logger = { info: record, warn: record, error: record };
  try {
    const result = await build(kind, spec).fetch({
      fetcher,
      now: new Date(spec.now),
      registry,
      log,
      previousFilms: previousFilmsFor(spec.salaMap ?? {}),
    });
    return { films: result.films, error: undefined, requests, gaps, events };
  } catch (error) {
    return { films: undefined, error, requests, gaps, events };
  }
}

/** What Python returned: every provider but the catalog site's reconciled its own movies. */
function asPython(kind: Kind, films: ScrapedFilm[]): unknown {
  const movies = toPythonFilms(films, registry);
  return kind === "english_cinema_bcn" ? movies : pythonReconcile(movies);
}

const sorted = (urls: readonly string[]): string[] => [...urls].sort();

function expectGolden(kind: Kind, outcome: Run, golden: z.infer<typeof Golden>): void {
  expect(outcome.gaps).toEqual([]);
  expect(sorted(outcome.requests)).toEqual(golden.requests);
  expect(outcome.events).toEqual(golden.events);
  if (golden.error) {
    const expected = ERROR_KINDS[golden.error.type];
    expect(expected, `no TS error stands for ${golden.error.type}`).toBeDefined();
    expect(outcome.error).toBeInstanceOf(expected);
    // Python's HTTPError text is the `requests` library's; the other two are the provider's own.
    if (golden.error.type !== "HTTPError") {
      expect(outcome.error).toHaveProperty("message", golden.error.message);
    }
    return;
  }
  expect(outcome.error).toBeUndefined();
  expect(asPython(kind, outcome.films ?? [])).toEqual(golden.result);
}

describe("every recording is covered", () => {
  const inline = join(FIXTURES, "recorded", "inline");

  it("has a parity test or an owner for every inline kind", () => {
    const kinds = readdirSync(inline, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(kinds.filter((kind) => ![...PROVIDER_KINDS, ...OTHER_KINDS].includes(kind))).toEqual([]);
    expect(PROVIDER_KINDS.filter((kind) => !kinds.includes(kind))).toEqual([]);
  });

  it("has a golden for every provider case", () => {
    for (const kind of PROVIDER_KINDS) {
      for (const name of readdirSync(join(inline, kind))) {
        expect(existsSync(join(FIXTURES, "goldens", "inline", kind, `${name}.json`))).toBe(true);
      }
    }
  });
});

for (const kind of PROVIDER_KINDS) {
  const recorded = join(FIXTURES, "recorded", "inline", kind);
  const cases = readdirSync(recorded, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  describe(`parity with Python: ${kind} (${cases.length} inline cases)`, () => {
    it.each(cases)("%s", async (name) => {
      const golden = Golden.parse(
        readJson(join(FIXTURES, "goldens", "inline", kind, `${name}.json`)),
      );
      expectGolden(kind, await run(kind, join(recorded, name)), golden);
    });
  });
}

describe("parity with Python: the live recording", () => {
  const live = readdirSync(join(FIXTURES, "recorded")).filter((name) => name.startsWith("live-"));

  it("finds the recording", () => {
    expect(live).not.toEqual([]);
  });

  describe.each(live)("%s", (set) => {
    const dir = join(FIXTURES, "recorded", set);
    const golden = (name: string): unknown =>
      readJson(join(FIXTURES, "goldens", set, `${name}.json`));

    it("verdi", async () => {
      const outcome = await run("verdi", dir);
      expect(outcome.error).toBeUndefined();
      expect(outcome.gaps).toEqual([]);
      expect(asPython("verdi", outcome.films ?? [])).toEqual(golden("verdi"));
    });

    // The legacy code reads only showtimes["original"], and the API now files them under
    // original_st, local, dubbed and so on, so Python's golden is empty. The port reproduces that.
    it("sensacine is [] by design: the legacy step keeps only the `original` version", async () => {
      const outcome = await run("sensacine", dir);
      expect(outcome.error).toBeUndefined();
      expect(outcome.gaps).toEqual([]);
      expect(golden("sensacine")).toEqual([]);
      expect(asPython("sensacine", outcome.films ?? [])).toEqual([]);
    });

    it("reconciling both is the golden's reconciled set", async () => {
      const [verdi, sensacine] = await Promise.all([run("verdi", dir), run("sensacine", dir)]);
      const films = [
        ...toPythonFilms(verdi.films ?? [], registry),
        ...toPythonFilms(sensacine.films ?? [], registry),
      ];
      // `verdi` is already reconciled by `asPython`'s stand-in; the live golden reconciles it again.
      expect(pythonReconcile(films)).toEqual(golden("reconciled"));
    });
  });
});
