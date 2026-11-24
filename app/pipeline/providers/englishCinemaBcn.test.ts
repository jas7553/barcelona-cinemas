import { describe, expect, it } from "vitest";
import { loadRegistry, buildCinemaAliasLookup, normalizeAlias } from "../registry.ts";
import { englishCinemaBcnProvider, parseShowtimeLabel } from "./englishCinemaBcn.ts";
import { context, recordingLogger, stubFetcher } from "./testFetcher.ts";

describe("parseShowtimeLabel", () => {
  it("reads a standard label, with the site's four-letter September", () => {
    expect(parseShowtimeLabel("Sun 13 Sept 20:45", "2026-09-13")).toEqual({
      date: "2026-09-13",
      time: "20:45",
    });
  });

  it("rolls a January date seen in December over to next year", () => {
    expect(parseShowtimeLabel("Mon 5 Jan 18:00", "2026-12-28")).toEqual({
      date: "2027-01-05",
      time: "18:00",
    });
  });

  it("keeps a date up to eight days past", () => {
    expect(parseShowtimeLabel("Sat 20 Sep 18:00", "2026-09-28")?.date).toBe("2026-09-20");
    expect(parseShowtimeLabel("Sat 19 Sep 18:00", "2026-09-28")?.date).toBe("2027-09-19");
  });

  it.each(["garbled", "", "Sat 5 Jan", "Sat xx Jan 18:00", "Sat 28 Foo 18:00", "Fri 29 Feb 18:00"])(
    "gives nothing for %j",
    (label) => {
      expect(parseShowtimeLabel(label, "2026-03-28")).toBeUndefined();
    },
  );

  it("gives nothing when the rolled-over year lacks the day", () => {
    expect(parseShowtimeLabel("Thu 29 Feb 18:00", "2028-03-20")).toBeUndefined();
  });
});

const FEED = "https://listings.example.test/films";
const catalog = (cards: string): string => `<div>${cards}</div>`;
const chip = (label: string, tags = ""): string =>
  `<a class="showtime-chip" data-showtime-label="${label}"><span class="showtime-chip-time">x</span>${tags}</a>`;
const tag = (text: string): string => `<span class="showtime-tag">${text}</span>`;
const block = (name: string, chips: string): string =>
  `<div class="cinema-block"><h3 class="cinema-block-name"><a> ${name} </a></h3>${chips}</div>`;

describe("englishCinemaBcnProvider", () => {
  const fetchFilm = async (chips: string) => {
    const { fetcher } = stubFetcher({
      [FEED]: catalog('<a class="film-card" data-title="Alien" href="/m/alien"></a>'),
      "https://listings.example.test/m/alien": block("Verdi", chips),
    });
    return englishCinemaBcnProvider({ feedUrl: FEED }).fetch(context(fetcher));
  };

  it.each([
    [chip("Sun 29 Mar 18:05", tag("IMAX")), "imax"],
    [chip("Sun 29 Mar 18:00"), undefined],
    [chip("Sun 29 Mar 18:00", tag("VOSE")), undefined],
    [chip("Sun 29 Mar 18:00", tag("VOSE") + tag("IMAX")), "imax"],
  ])("reads the premium format of %s", async (chips, expected) => {
    const { films } = await fetchFilm(chips);
    expect(films[0]?.showings[0]?.premium_format).toBe(expected);
  });

  it("keeps the raw format label and every showing as vo at Madrid's offset", async () => {
    const { films } = await fetchFilm(chip("Sun 29 Mar 18:05", tag("Sala IMAX")));
    expect(films).toEqual([
      {
        title: "Alien",
        showings: [
          {
            cinema: "Verdi",
            starts_at: "2026-03-29T18:05+02:00",
            language: "vo",
            premium_format: "imax",
            labels: { format: "Sala IMAX" },
          },
        ],
      },
    ]);
  });

  it("drops an unknown cinema's showings and says which names it did not know", async () => {
    const { fetcher } = stubFetcher({
      [FEED]: catalog('<a class="film-card" data-title="Alien" href="/m/alien"></a>'),
      "https://listings.example.test/m/alien": block("Nowhere", chip("Sun 29 Mar 18:00")),
    });
    const { log, events } = recordingLogger();
    const { films } = await englishCinemaBcnProvider({ feedUrl: FEED }).fetch(
      context(fetcher, { log }),
    );
    expect(films).toEqual([]);
    expect(events).toEqual([
      {
        event: "unrecognized_cinema_names",
        fields: { provider: "english_cinema_bcn", names: ["Nowhere"] },
      },
    ]);
  });

  it("asks for the configured feed, with the entry page kept for diagnostics", async () => {
    const { fetcher, requests } = stubFetcher({
      "https://example.com/films": catalog('<a class="film-card" data-title="A" href="/m/a"></a>'),
      "https://example.com/m/a": block("Verdi", chip("Sun 29 Mar 18:00")),
    });
    const result = await englishCinemaBcnProvider({ feedUrl: "https://example.com/films" }).fetch(
      context(fetcher),
    );
    expect(requests.map(({ url, timeoutMs }) => [url, timeoutMs])).toEqual([
      ["https://example.com/films", 15_000],
      ["https://example.com/m/a", 15_000],
    ]);
    expect(result.entry).toMatchObject({ url: "https://example.com/films", status: 200 });
  });

  it("fails without a feed URL", async () => {
    const { fetcher } = stubFetcher({});
    await expect(
      englishCinemaBcnProvider({ feedUrl: undefined }).fetch(context(fetcher)),
    ).rejects.toThrow("LISTINGS_FEED_URL");
  });
});

describe("the real registry's english_cinema_bcn aliases", () => {
  it.each([
    ["Arenas de Barcelona Multicines", "Arenas"],
    ["Cinemes Verdi", "Verdi"],
    ["Mooby Gran Sarrià", "Sarrià"],
    ["Zumzeig Cinema", "Zumzeig"],
  ])("%s resolves to %s", (siteName, key) => {
    const lookup = buildCinemaAliasLookup(loadRegistry(), "english_cinema_bcn");
    expect(lookup.get(normalizeAlias(siteName))).toBe(key);
  });
});
