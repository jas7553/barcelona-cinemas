import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inSpanishFirstRun, isFeatureLength, rankCandidates } from "./tmdb-rank.ts";
import { Detail, SearchResponse } from "./tmdb-schema.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, FIXTURES), "utf8"));
}

interface RankCase {
  today: string;
  title?: string;
  results?: unknown[];
  year?: number;
  details?: unknown[];
}

describe("TMDb ranking parity with Python", () => {
  const cases = readdirSync(new URL("recorded/inline/tmdb-rank/", FIXTURES)).sort();

  it("has a golden for every recorded case, and a case for every golden", () => {
    const goldens = readdirSync(new URL("goldens/inline/tmdb-rank/", FIXTURES))
      .map((file) => file.replace(/\.json$/, ""))
      .sort();
    expect(cases).toEqual(goldens);
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("%s", (name) => {
    const { today, title, results, year, details } = readJson(
      `recorded/inline/tmdb-rank/${name}/case.json`,
    ) as RankCase;
    const actual: { firstRun?: number[]; ordered?: number[]; inSpanishFirstRun?: boolean[] } = {};
    if (title !== undefined && results !== undefined) {
      const parsed = SearchResponse.parse({ results }).results;
      expect(parsed).toHaveLength(results.length);
      const { firstRun, ordered } = rankCandidates(title, parsed, { year, today });
      actual.firstRun = firstRun.map((r) => r.id);
      actual.ordered = ordered.map((r) => r.id);
    }
    if (details !== undefined) {
      actual.inSpanishFirstRun = details.map((d) => inSpanishFirstRun(Detail.parse(d), today));
    }
    expect(actual).toEqual(readJson(`goldens/inline/tmdb-rank/${name}.json`));
  });
});

describe("isFeatureLength", () => {
  it.each([
    [undefined, true],
    [0, true],
    [39, false],
    [40, true],
    [-10, false],
  ])("runtime %s → %s", (runtime, expected) => {
    expect(isFeatureLength(Detail.parse({ runtime }))).toBe(expected);
  });
});
