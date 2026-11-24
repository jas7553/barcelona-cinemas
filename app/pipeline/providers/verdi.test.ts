import { describe, expect, it } from "vitest";
import { HttpError, PartialFetchError } from "../errors.ts";
import type { ScrapedFilm } from "../types.ts";
import { context, recordingLogger, stubFetcher, TIMEOUT, type Page } from "./testFetcher.ts";
import {
  extractFilmMeta,
  isVo,
  legacyEnglishOnly,
  parseSessions,
  salaMapFromFilms,
  slots,
  verdiProvider,
} from "./verdi.ts";

const SEATS = "https://verdibcn.admit-one.eu/seats";
const FILM_BASE = "https://barcelona.cines-verdi.com";

const ldJson = (sameAs: unknown = "https://www.imdb.com/title/tt12345678", name = "Obsession") =>
  `<script type="application/ld+json">${JSON.stringify({
    "@graph": [
      { "@type": "MovieTheater", name: "Cinemes Verdi" },
      { "@type": "Movie", name, sameAs },
    ],
  })}</script>`;

const button = (id: number, day: number, time: string, label = "V.O. SUB. CASTELLÀ") =>
  `<a href="${SEATS}/${id}/" x-show="!isPast(&#039;202606${String(day).padStart(2, "0")}${time.replace(":", "")}00&#039;)" x-cloak><time>${time}</time><small>${label}</small></a>`;

describe("extractFilmMeta", () => {
  it("reads the title and IMDb id", () => {
    expect(extractFilmMeta(ldJson())).toEqual({ title: "Obsession", imdbId: "tt12345678" });
  });

  it("reads sameAs as a list of URLs", () => {
    expect(
      extractFilmMeta(ldJson(["https://x.test/", "https://www.imdb.com/title/tt99/"]))?.imdbId,
    ).toBe("tt99");
  });

  it("has no IMDb id when sameAs is another kind of value", () => {
    expect(extractFilmMeta(ldJson(7))).toEqual({ title: "Obsession", imdbId: undefined });
  });

  it("is undefined without JSON-LD, with an array root, or with invalid JSON", () => {
    expect(extractFilmMeta("<html></html>")).toBeUndefined();
    expect(
      extractFilmMeta('<script type="application/ld+json">[{"@type":"Movie","name":"X"}]</script>'),
    ).toBeUndefined();
    expect(extractFilmMeta('<script type="application/ld+json">{oops</script>')).toBeUndefined();
  });
});

describe("parseSessions", () => {
  it("reads every session, dubbed ones too, with the button's own label", () => {
    expect(
      parseSessions(button(100001, 28, "18:30") + button(100003, 28, "16:00", " CASTELLÀ ")),
    ).toEqual([
      {
        date: "2026-06-28",
        time: "18:30",
        id: "100001",
        bookingUrl: `${SEATS}/100001/`,
        label: "V.O. SUB. CASTELLÀ",
      },
      {
        date: "2026-06-28",
        time: "16:00",
        id: "100003",
        bookingUrl: `${SEATS}/100003/`,
        label: "CASTELLÀ",
      },
    ]);
  });
});

describe("isVo and the legacy step", () => {
  it("takes a V.O. prefix, not a dubbed label", () => {
    expect([isVo("V.O. SUB. CASTELLÀ"), isVo(" v.o.s.e."), isVo("CASTELLÀ")]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("keeps V.O. sessions and drops a film with none", () => {
    const sessions = parseSessions(button(1, 28, "18:00") + button(2, 28, "16:00", "CASTELLÀ"));
    expect(
      legacyEnglishOnly({ title: "T", imdbId: undefined, sessions })?.sessions.map(({ id }) => id),
    ).toEqual(["1"]);
    expect(
      legacyEnglishOnly({ title: "T", imdbId: undefined, sessions: sessions.slice(1) }),
    ).toBeUndefined();
  });
});

describe("slots", () => {
  it("groups session ids by time, latest date first", () => {
    const sessions = parseSessions(
      button(1, 26, "20:00") +
        button(2, 28, "20:00") +
        button(3, 27, "20:00") +
        button(4, 26, "18:00"),
    );
    expect(slots({ title: "T", imdbId: undefined, sessions })).toEqual([["2", "3", "1"], ["4"]]);
  });
});

describe("salaMapFromFilms", () => {
  const film = (showings: { cinema: string; booking_url?: string }[]): ScrapedFilm => ({
    title: "T",
    showings: showings.map((s) => ({ starts_at: "2026-07-28T20:00+02:00", language: "vo", ...s })),
  });

  it("reads session ids from Verdi and Verdi Park booking URLs", () => {
    expect(
      salaMapFromFilms([
        film([
          { cinema: "Verdi", booking_url: `${SEATS}/500001/` },
          { cinema: "VP", booking_url: `${SEATS}/500002/` },
        ]),
      ]),
    ).toEqual(
      new Map([
        ["500001", "Verdi"],
        ["500002", "VP"],
      ]),
    );
  });

  it("ignores other cinemas, foreign URLs and showings without one", () => {
    expect(
      salaMapFromFilms([
        film([
          { cinema: "Renoir", booking_url: `${SEATS}/600001/` },
          { cinema: "Verdi", booking_url: "https://example.com/seats/600002/" },
          { cinema: "Verdi" },
        ]),
      ]).size,
    ).toBe(0);
  });

  it("is empty on a cold start", () => {
    expect(salaMapFromFilms([]).size).toBe(0);
  });
});

describe("verdiProvider", () => {
  const cartellera = (...slugs: string[]) =>
    slugs.map((s) => `<a href="${s}" class="group"></a>`).join("");
  const SEAT_VERDI = "<p>Cines Verdi Barcelona | Sala 3</p>";

  const pages = (extra: Record<string, Page> = {}) => ({
    [`${FILM_BASE}/cartellera`]: cartellera("/obsession"),
    [`${FILM_BASE}/obsession`]:
      ldJson() + button(100001, 28, "18:30") + button(100002, 28, "20:30"),
    ...extra,
  });

  it("looks up the sala with the 3 s timeout, one request per time slot", async () => {
    const { fetcher, requests } = stubFetcher(
      pages({ [`${SEATS}/100001/`]: SEAT_VERDI, [`${SEATS}/100002/`]: SEAT_VERDI }),
    );
    const { films } = await verdiProvider().fetch(context(fetcher));
    expect(films[0]?.showings.map(({ cinema }) => cinema)).toEqual(["Verdi", "Verdi"]);
    expect(
      requests.filter(({ url }) => url.startsWith(SEATS)).map(({ timeoutMs }) => timeoutMs),
    ).toEqual([3000, 3000]);
  });

  it("keeps the raw label and resolves Verdi Park from a letter sala", async () => {
    const { fetcher } = stubFetcher(
      pages({
        [`${SEATS}/100001/`]: "Cines Verdi Barcelona | Sala D V.Park",
        [`${SEATS}/100002/`]: "Sala D V.Park",
      }),
    );
    const { films } = await verdiProvider().fetch(context(fetcher));
    expect(films[0]?.showings[0]).toMatchObject({
      cinema: "VP",
      subtitle_lang: "es",
      booking_url: `${SEATS}/100001/`,
      labels: { version: "V.O. SUB. CASTELLÀ" },
    });
  });

  it("does not ask about the sala of a session the legacy step dropped", async () => {
    const { fetcher, requests } = stubFetcher(
      pages({
        [`${FILM_BASE}/obsession`]:
          ldJson() + button(100001, 28, "18:30") + button(100009, 28, "16:00", "CASTELLÀ"),
        [`${SEATS}/100001/`]: SEAT_VERDI,
      }),
    );
    await verdiProvider().fetch(context(fetcher));
    expect(requests.map(({ url }) => url)).not.toContain(`${SEATS}/100009/`);
  });

  it("leaves out sessions with no sala, whether the page errors or names none", async () => {
    const { fetcher } = stubFetcher(
      pages({
        [`${FILM_BASE}/obsession`]:
          ldJson() +
          button(1, 28, "14:00") +
          button(2, 28, "16:00") +
          button(3, 28, "18:00") +
          button(4, 28, "20:00") +
          button(5, 28, "22:00"),
        [`${SEATS}/1/`]: SEAT_VERDI,
        [`${SEATS}/2/`]: SEAT_VERDI,
        [`${SEATS}/3/`]: SEAT_VERDI,
        [`${SEATS}/4/`]: SEAT_VERDI,
        [`${SEATS}/5/`]: "<p>session expired</p>",
      }),
    );
    const { log, events } = recordingLogger();
    const { films } = await verdiProvider().fetch(context(fetcher, { log }));
    expect(films[0]?.showings).toHaveLength(4);
    expect(events.find(({ event }) => event === "provider_partial_failure")?.fields).toMatchObject({
      kind: "showtimes without a sala",
      failed_count: 1,
      total_count: 5,
    });
  });

  it("repeats only the failed lookups when the same provider fetches again", async () => {
    const stub = stubFetcher(
      pages({
        [`${FILM_BASE}/obsession`]:
          ldJson() +
          button(1, 28, "14:00") +
          button(2, 28, "16:00") +
          button(3, 28, "18:00") +
          button(4, 28, "20:00") +
          button(5, 28, "22:00"),
        [`${SEATS}/1/`]: SEAT_VERDI,
        [`${SEATS}/2/`]: SEAT_VERDI,
        [`${SEATS}/3/`]: SEAT_VERDI,
        [`${SEATS}/4/`]: SEAT_VERDI,
        [`${SEATS}/5/`]: TIMEOUT,
      }),
    );
    const provider = verdiProvider();
    await provider.fetch(context(stub.fetcher));
    stub.requests.length = 0;
    await provider.fetch(context(stub.fetcher));
    expect(stub.requests.map(({ url }) => url).filter((url) => url.startsWith(SEATS))).toEqual([
      `${SEATS}/5/`,
    ]);
  });

  it("takes a session's sala from the previous films and looks up only the rest", async () => {
    const { fetcher, requests } = stubFetcher(pages({ [`${SEATS}/100002/`]: SEAT_VERDI }));
    const previousFilms: ScrapedFilm[] = [
      {
        title: "T",
        showings: [
          {
            cinema: "VP",
            starts_at: "2026-06-27T18:30+02:00",
            language: "vo",
            booking_url: `${SEATS}/100001/`,
          },
        ],
      },
    ];
    const { films } = await verdiProvider().fetch(context(fetcher, { previousFilms }));
    expect(films[0]?.showings.map(({ cinema }) => cinema)).toEqual(["VP", "Verdi"]);
    expect(requests.map(({ url }) => url).filter((url) => url.startsWith(SEATS))).toEqual([
      `${SEATS}/100002/`,
    ]);
  });

  it("fails when the cartellera does", async () => {
    const { fetcher } = stubFetcher({ [`${FILM_BASE}/cartellera`]: { status: 503 } });
    await expect(verdiProvider().fetch(context(fetcher))).rejects.toBeInstanceOf(HttpError);
  });

  it("fails when every film page does, the share lost being past the limit", async () => {
    const { fetcher } = stubFetcher({
      [`${FILM_BASE}/cartellera`]: cartellera("/obsession"),
      [`${FILM_BASE}/obsession`]: TIMEOUT,
    });
    await expect(verdiProvider().fetch(context(fetcher))).rejects.toBeInstanceOf(PartialFetchError);
  });

  it("keeps the cartellera as the entry page for diagnostics", async () => {
    const { fetcher } = stubFetcher({ [`${FILM_BASE}/cartellera`]: "" });
    const result = await verdiProvider().fetch(context(fetcher));
    expect(result).toMatchObject({
      films: [],
      entry: { url: `${FILM_BASE}/cartellera`, status: 200 },
    });
  });
});
