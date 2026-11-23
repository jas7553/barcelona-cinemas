import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Listings } from "../shared/listings.ts";
import { addDays, cinemaDay, madridWallClock } from "../shared/madrid.ts";
import { buildFixture } from "./build.ts";

const NOW = new Date("2026-11-23T18:00:00+01:00");

describe("validates", () => {
  it.each([
    ["the day before clocks go forward", "2026-03-28T12:00:00+01:00"],
    ["clocks going forward", "2026-03-29T01:59:00+01:00"],
    ["after clocks go forward", "2026-03-29T03:00:00+02:00"],
    ["the day before clocks go back", "2026-10-24T12:00:00+02:00"],
    ["the first 02:30 when clocks go back", "2026-10-25T02:30:00+02:00"],
    ["the second 02:30 when clocks go back", "2026-10-25T02:30:00+01:00"],
    ["05:59 Madrid", "2026-11-23T05:59:00+01:00"],
    ["06:00 Madrid", "2026-11-23T06:00:00+01:00"],
    ["23:59 Madrid", "2026-11-23T23:59:00+01:00"],
    ["midnight on New Year", "2027-01-01T00:00:00+01:00"],
    ["a leap day", "2028-02-29T12:00:00+01:00"],
  ])("at %s", (_, iso) => {
    expect(() => Listings.parse(buildFixture(new Date(iso)))).not.toThrow();
  });

  it("for any now", () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date("2020-01-01T00:00:00Z"),
          max: new Date("2040-12-31T23:59:59Z"),
          noInvalidDate: true,
        }),
        (now) => {
          expect(Listings.safeParse(buildFixture(now)).error).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});

it("is deterministic", () => {
  expect(buildFixture(new Date(NOW))).toStrictEqual(buildFixture(NOW));
});

describe("covers", () => {
  const doc = buildFixture(NOW);
  const today = cinemaDay(NOW);
  const all = doc.films.flatMap((f) => f.showings.map((s) => ({ film: f, ...s })));
  const days = (filmId: string) =>
    all.filter((s) => s.film.id === filmId).map((s) => cinemaDay(new Date(s.starts_at)));

  it("4–6 cinemas across several chains, with exact and lower-bound published_through", () => {
    expect(doc.cinemas.length).toBeGreaterThanOrEqual(4);
    expect(doc.cinemas.length).toBeLessThanOrEqual(6);
    expect(new Set(doc.cinemas.map((c) => c.chain)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(doc.cinemas.map((c) => c.coverage))).toEqual(new Set(["full", "english_only"]));
  });

  it("showings no later than each cinema's published_through", () => {
    for (const s of all) {
      const through = doc.cinemas.find((c) => c.id === s.cinema_id)?.published_through ?? "";
      expect(cinemaDay(new Date(s.starts_at)) <= through).toBe(true);
    }
  });

  it("21 days from today", () => {
    const sorted = all.map((s) => cinemaDay(new Date(s.starts_at))).sort();
    expect(sorted[0]).toBe(today);
    expect(sorted.at(-1)).toBe(addDays(today, 20));
  });

  it("an English original, the same film dubbed, a non-English original and unknown audio", () => {
    const english = all.filter((s) => s.version === "original" && s.audio === "en");
    const dubbed = all.filter((s) => s.version === "dubbed");
    expect(dubbed.some((d) => english.some((e) => e.film.id === d.film.id))).toBe(true);
    expect(all.some((s) => s.version === "original" && s.audio === "other")).toBe(true);
    expect(all.some((s) => s.audio === "unknown")).toBe(true);
  });

  it("an unmatched film with no poster", () => {
    expect(doc.films.some((f) => f.tmdb_id === undefined && f.poster_path === undefined)).toBe(
      true,
    );
  });

  it("a very long title", () => {
    expect(doc.films.some((f) => f.title.length > 100)).toBe(true);
  });

  it("a film starting after today and one whose last showing is tomorrow", () => {
    expect(doc.films.some((f) => f.showings.length > 0 && days(f.id).every((d) => d > today))).toBe(
      true,
    );
    expect(doc.films.some((f) => days(f.id).sort().at(-1) === addDays(today, 1))).toBe(true);
  });

  it("an after-midnight showing and the time-of-day boundaries", () => {
    const times = new Set(all.map((s) => madridWallClock(new Date(s.starts_at)).time));
    for (const time of ["00:30", "16:59", "17:00", "20:59", "21:00"]) {
      expect(times).toContain(time);
    }
  });

  it("showings with and without a booking link", () => {
    expect(new Set(all.map((s) => s.booking_url === undefined))).toEqual(new Set([true, false]));
  });

  it("a film with a previous id", () => {
    expect(doc.films.some((f) => f.previous_ids !== undefined)).toBe(true);
  });

  it("an ended film, with no showings", () => {
    expect(doc.films.some((f) => f.showings.length === 0)).toBe(true);
  });
});
