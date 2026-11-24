import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Logger, LogFields } from "./log.ts";
import {
  dedupShowings,
  normalizeTitle,
  reconcile,
  sameFilm,
  type ReconcileStage,
} from "./reconcile.ts";
import { canonicalPython, filmFromPython, toCanonicalPython } from "./testing/python-enriched.ts";
import type { ScrapedFilm, ScrapedShowing } from "./types.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, FIXTURES), "utf8"));
}

function captureLog(): { log: Logger; events: LogFields[] } {
  const events: LogFields[] = [];
  const log: Logger = {
    info: (event, fields = {}) => events.push({ event, ...fields }),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { log, events };
}

interface ReconcileCase {
  movies: unknown[];
  stage?: ReconcileStage;
}

interface ReconcileGolden {
  result: unknown[];
  events: LogFields[];
}

// TypeScript keeps original-version showings only, so the one case with a dubbed showing is
// compared without it. Python keys showings on language, so dropping them changes nothing else.
function withoutDubbed(movies: unknown[]): unknown[] {
  return movies.map((movie) => {
    const { showtimes, ...rest } = movie as { showtimes: { language?: string }[] };
    return { ...rest, showtimes: showtimes.filter((s) => s.language !== "dub") };
  });
}

describe("reconcile parity with Python", () => {
  const cases = readdirSync(new URL("recorded/inline/reconcile/", FIXTURES)).sort();

  it("has a golden for every recorded case, and a case for every golden", () => {
    const goldens = readdirSync(new URL("goldens/inline/reconcile/", FIXTURES))
      .map((file) => file.replace(/\.json$/, ""))
      .sort();
    expect(cases).toEqual(goldens);
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("%s", (name) => {
    const { movies, stage } = readJson(
      `recorded/inline/reconcile/${name}/case.json`,
    ) as ReconcileCase;
    const golden = readJson(`goldens/inline/reconcile/${name}.json`) as ReconcileGolden;
    const { log, events } = captureLog();

    const result = reconcile(withoutDubbed(movies).map(filmFromPython), stage && { stage, log });

    expect(result.map(toCanonicalPython)).toEqual(
      withoutDubbed(golden.result).map(canonicalPython),
    );
    expect(events).toEqual(golden.events);
  });

  it("matches the live recording's collection-stage reconcile", () => {
    const set = "goldens/live-2026-11-24";
    const provided = [
      ...(readJson(`${set}/verdi.json`) as unknown[]),
      ...(readJson(`${set}/sensacine.json`) as unknown[]),
    ];
    const golden = readJson(`${set}/reconciled.json`) as unknown[];
    expect(golden.length).toBeGreaterThan(0);

    const result = reconcile(provided.map(filmFromPython), {
      stage: "collection",
      log: captureLog().log,
    });

    expect(result.map(toCanonicalPython)).toEqual(golden.map(canonicalPython));
  });
});

const showing = (fields: Partial<ScrapedShowing> = {}): ScrapedShowing => ({
  cinema: "Verdi",
  starts_at: "2026-06-14T18:00+02:00",
  language: "vo",
  ...fields,
});

const film = (title: string, fields: Partial<ScrapedFilm> = {}): ScrapedFilm => ({
  title,
  showings: [],
  ...fields,
});

describe("normalizeTitle", () => {
  it("folds case as Python's casefold does, beyond ASCII", () => {
    expect(normalizeTitle("Die Weiße Rose")).toBe(normalizeTitle("DIE WEISSE ROSE"));
    expect(normalizeTitle("ΟΔΥΣΣΕΑΣ")).toBe("οδυσσεασ");
  });

  it("collapses Unicode spaces between words but strips only ASCII ones at the edges", () => {
    expect(normalizeTitle("Perfect  Days")).toBe("perfect days");
    expect(normalizeTitle("«Perfect Days»")).toBe("«perfect days»");
  });
});

describe("sameFilm", () => {
  it("matches equal imdb ids whatever the titles", () => {
    expect(
      sameFilm(film("Dune", { imdb_id: "tt1" }), film("Dune: Part One", { imdb_id: "tt1" })),
    ).toBe(true);
  });

  it("never matches different imdb ids, even under one title", () => {
    expect(sameFilm(film("Dune", { imdb_id: "tt1" }), film("Dune", { imdb_id: "tt2" }))).toBe(
      false,
    );
  });

  it("falls back to the title when either lacks an imdb id", () => {
    expect(sameFilm(film("Dune", { imdb_id: "tt1" }), film("dune"))).toBe(true);
    expect(sameFilm(film("Dune"), film("Oppenheimer"))).toBe(false);
  });
});

describe("reconcile", () => {
  it("returns a lone film as it came, showings unsorted", () => {
    const late = showing({ starts_at: "2026-06-14T22:00+02:00" });
    const only = film("Dune", { showings: [late, showing()] });
    expect(reconcile([only])[0]).toBe(only);
  });

  it("keeps the base copy's labels and fills the ones it lacks", () => {
    const [merged] = reconcile([
      film("Dune", { showings: [showing({ labels: { version: "V.O.S.E." } })] }),
      film("Dune", { showings: [showing({ labels: { version: "original", format: "IMAX" } })] }),
    ]);
    expect(merged?.showings).toEqual([
      showing({ labels: { version: "V.O.S.E.", format: "IMAX" } }),
    ]);
  });
});

describe("dedupShowings", () => {
  const key = (s: ScrapedShowing): string => `${s.starts_at}|${s.cinema}`;

  it("leaves its inputs unmutated", () => {
    const premium = showing({ premium_format: "imax" });
    const linked = showing({ booking_url: "https://book" });
    dedupShowings([linked, premium], key);
    expect(linked).not.toHaveProperty("premium_format");
    expect(premium).not.toHaveProperty("booking_url");
  });

  it("keeps first-seen order", () => {
    const a = showing();
    const b = showing({ cinema: "Malda", starts_at: "2026-06-14T20:00+02:00" });
    expect(dedupShowings([a, b], key)).toEqual([a, b]);
  });
});
