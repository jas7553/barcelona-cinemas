import { describe, expect, it } from "vitest";
import { loadRegistry } from "../registry.ts";
import type { ScrapedFilm } from "../types.ts";
import {
  ADMIT_ONE_THEATRES,
  bookingUrl,
  fetchDates,
  legacyEnglishOnly,
  LEGACY_DAYS_AHEAD,
  parsePage,
  SENSACINE_IDS,
  sensacineProvider,
} from "./sensacine.ts";
import { context, recordingLogger, stubFetcher } from "./testFetcher.ts";

const MOOBY_TEMPLATE =
  "https://moobycinemas-balmes.admit-one.eu/?p=tickets&perfCode=188474&language=%s&theatre=%s";

const showtime = (startsAt: string, tags: string[] = [], urls: unknown[] = []) => ({
  startsAt,
  tags,
  data: { ticketing: urls.length ? [{ provider: "default", urls }] : [] },
});
const entry = (title: string, languages: string[], showtimes: Record<string, unknown[]>) => ({
  movie: { title, languages },
  showtimes,
});

describe("parsePage", () => {
  it("keeps every version, labelled with the source's key", () => {
    const films = parsePage(
      {
        results: [
          entry("Film", ["ENGLISH"], {
            original: [showtime("2026-06-29T16:00:00")],
            original_st: [showtime("2026-06-29T18:00:00")],
            local: [showtime("2026-06-29T20:00:00")],
            dubbed: [],
          }),
        ],
      },
      "Verdi",
    );
    expect(
      films?.[0]?.showings.map(({ starts_at, labels }) => [starts_at, labels?.version]),
    ).toEqual([
      ["2026-06-29T16:00+02:00", "original"],
      ["2026-06-29T18:00+02:00", "original_st"],
      ["2026-06-29T20:00+02:00", "local"],
    ]);
  });

  it.each([
    [["Localization.Subtitle.Spanish"], "es"],
    [["Localization.Subtitle.Catalan"], "ca"],
    [["Localization.Subtitle.English"], "en"],
    [["Format.Projection.Digital"], undefined],
  ])("reads the subtitle language from tags %j", (tags, expected) => {
    const films = parsePage(
      { results: [entry("F", ["ENGLISH"], { original: [showtime("2026-06-29T16:00:00", tags)] })] },
      "Verdi",
    );
    expect(films?.[0]?.showings[0]?.subtitle_lang).toBe(expected);
  });

  it.each([
    [["Localization.Version.Original", "Format.Projection.Imax"], "imax"],
    [["Format.Projection.Digital"], undefined],
    [["Localization.Subtitle.Spanish"], undefined],
  ])("reads the premium format from tags %j", (tags, expected) => {
    const films = parsePage(
      { results: [entry("F", [], { original: [showtime("2026-06-29T16:00:00", tags)] })] },
      "Verdi",
    );
    expect(films?.[0]?.showings[0]?.premium_format).toBe(expected);
  });

  it("marks audio from the film's languages: English, another language, or unknown", () => {
    const audio = (languages: string[]) =>
      parsePage(
        { results: [entry("F", languages, { original: [showtime("2026-06-29T16:00:00")] })] },
        "Verdi",
      )?.[0]?.showings[0]?.audio_lang;
    expect([audio(["ENGLISH", "FRENCH"]), audio(["SPANISH"]), audio([])]).toEqual([
      "en",
      "other",
      undefined,
    ]);
  });

  it("is undefined for a body that is not a page, and skips entries without a title", () => {
    expect(parsePage("nope", "Verdi")).toBeUndefined();
    expect(
      parsePage(
        { results: [entry(" ", [], { original: [showtime("2026-06-29T16:00:00")] })] },
        "Verdi",
      ),
    ).toEqual([]);
  });
});

describe("bookingUrl", () => {
  const entries = (...list: [string, string][]) =>
    list.map(([provider, url]) => ({ provider, urls: [url] }));

  it("prefers the default provider, else the first relay, else nothing", () => {
    expect(
      bookingUrl(entries(["relay", "https://r.test/x"], ["default", "https://d.test/y"])),
    ).toBe("https://d.test/y");
    expect(bookingUrl(entries(["relay", "https://r.test/x"]))).toBe("https://r.test/x");
    expect(bookingUrl([])).toBeUndefined();
  });

  it("fills an Admit One template in English for the cinema's theatre", () => {
    expect(bookingUrl(entries(["default", MOOBY_TEMPLATE]), "BAL-BALMES")).toBe(
      "https://moobycinemas-balmes.admit-one.eu/?p=tickets&perfCode=188474&language=ENG&theatre=BAL-BALMES",
    );
  });

  it("skips a template it can't fill and falls back to the relay", () => {
    const both = entries(["relay", "https://r.test/x"], ["default", MOOBY_TEMPLATE]);
    expect(bookingUrl(both)).toBe("https://r.test/x");
    expect(bookingUrl(both.slice(1))).toBeUndefined();
  });
});

describe("legacyEnglishOnly", () => {
  it("keeps only `original` showings of films not known to be in another language", () => {
    const body = {
      results: [
        entry("English", ["ENGLISH"], {
          original: [showtime("2026-06-29T16:00:00")],
          original_st: [showtime("2026-06-29T17:00:00")],
          local: [showtime("2026-06-29T18:00:00")],
        }),
        entry("Español", ["SPANISH"], { original: [showtime("2026-06-29T19:00:00")] }),
        entry("Unknown", [], { original: [showtime("2026-06-29T20:00:00")] }),
        entry("Dubbed only", ["ENGLISH"], { dubbed: [showtime("2026-06-29T21:00:00")] }),
      ],
    };
    const kept: ScrapedFilm[] = legacyEnglishOnly(parsePage(body, "Verdi") ?? []);
    expect(kept.map(({ title, showings }) => [title, showings.length])).toEqual([
      ["English", 1],
      ["Unknown", 1],
    ]);
  });
});

describe("fetchDates", () => {
  it("starts on Madrid's day when UTC is still on the previous one", () => {
    expect(fetchDates(new Date("2026-07-14T22:30:00Z"), 2)).toEqual(["2026-07-15", "2026-07-16"]);
  });

  it("starts on the UTC day away from midnight", () => {
    expect(fetchDates(new Date("2026-07-14T12:00:00Z"), 2)).toEqual(["2026-07-14", "2026-07-15"]);
  });

  it("covers the legacy window by default", () => {
    expect(fetchDates(new Date("2026-07-14T12:00:00Z"), LEGACY_DAYS_AHEAD)).toHaveLength(7);
  });
});

describe("the theatre tables", () => {
  const registry = loadRegistry();

  it("keep the Admit One cinemas among the SensaCine cinemas, all in the registry", () => {
    for (const key of Object.keys(ADMIT_ONE_THEATRES)) {
      expect(SENSACINE_IDS).toHaveProperty(key);
      expect(registry.has(key)).toBe(true);
    }
  });

  it("leave out Méliès, which SensaCine doesn't list", () => {
    expect(SENSACINE_IDS).not.toHaveProperty("Méliès");
  });
});

describe("sensacineProvider", () => {
  const url = (id: string, date: string) =>
    `https://www.sensacine.com/_/showtimes/theater-${id}/d-${date}/`;
  const english = JSON.stringify({
    results: [entry("Film", ["ENGLISH"], { original: [showtime("2026-03-28T16:00:00")] })],
  });
  const ids = { Verdi: "E1", Missing: "E2" };

  it("warns of a key the registry lacks, asks for the rest, and reports nothing when all answer", async () => {
    const { fetcher, requests } = stubFetcher({ [url("E1", "2026-03-28")]: english });
    const { log, events } = recordingLogger();
    const { films } = await sensacineProvider({ ids, daysAhead: 1 }).fetch(
      context(fetcher, { log }),
    );
    expect(films).toHaveLength(1);
    expect(requests).toEqual([{ url: url("E1", "2026-03-28"), timeoutMs: 15_000 }]);
    expect(events.map(({ event }) => event)).toEqual(["sensacine_keys_not_in_registry"]);
  });

  it("keeps the rest and reports the pages it lost", async () => {
    const onDay = (date: string): string =>
      JSON.stringify({
        results: [entry("Film", ["ENGLISH"], { original: [showtime(`${date}T16:00:00`)] })],
      });
    const { fetcher } = stubFetcher({
      [url("E1", "2026-03-28")]: onDay("2026-03-28"),
      [url("E1", "2026-03-29")]: onDay("2026-03-29"),
      [url("E1", "2026-03-30")]: onDay("2026-03-30"),
      [url("E1", "2026-03-31")]: { status: 500 },
    });
    const { log, events } = recordingLogger();
    const { films } = await sensacineProvider({ ids: { Verdi: "E1" }, daysAhead: 4 }).fetch(
      context(fetcher, { log }),
    );
    expect(films.map(({ showings }) => showings.map(({ starts_at }) => starts_at))).toEqual([
      ["2026-03-28T16:00+01:00", "2026-03-29T16:00+02:00", "2026-03-30T16:00+02:00"],
    ]);
    expect(events.find(({ event }) => event === "provider_partial_failure")?.fields).toEqual({
      provider: "sensacine",
      kind: "pages",
      failed_count: 1,
      total_count: 4,
    });
  });
});
