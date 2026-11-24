import { describe, expect, it } from "vitest";
import {
  extractShops,
  fillTemplate,
  legacyEnglishOnly,
  parseShops,
  secondaryProvider,
} from "./secondary.ts";
import { ProviderParseError } from "./support.ts";
import { context, recordingLogger, stubFetcher, testRegistry } from "./testFetcher.ts";

const LISTINGS = "https://secondary.example.test/";

const page = (shops: unknown): string =>
  `<script>window.shops = ${JSON.stringify(shops)};</script>`;

const performance = {
  schedule_date: "20260329",
  time: "20260329183000",
  performance_code: "187518",
};
const event = (language: string, subtitles: string, name = "Film") => ({
  name,
  imdbid: "tt1",
  language,
  subtitles_lang: subtitles,
  performances: [performance],
});
const aribau = (events: unknown[], extra: object = {}) => ({
  label: "ARIBAU",
  code: "BAL-ARIBAU",
  shop_url: "https://t.test/?perfCode=%s&language=%s&theatre=%s",
  events,
  ...extra,
});

describe("extractShops", () => {
  it("fails on a page without the blob, or with one that is not JSON", () => {
    expect(() => extractShops("<html></html>")).toThrow(ProviderParseError);
    expect(() => extractShops("window.shops = {nope};")).toThrow("Could not decode shops payload");
  });
});

describe("fillTemplate", () => {
  it("fills the three slots in order by replacement, so a pre-encoded %20 is harmless", () => {
    expect(fillTemplate("https://t.test/a%20b?p=%s&l=%s&t=%s", ["1", "ENG", "BAL"])).toBe(
      "https://t.test/a%20b?p=1&l=ENG&t=BAL",
    );
  });

  it("inserts a value literally, even one with replacement patterns in it", () => {
    expect(fillTemplate("%s-%s-%s", ["$&", "$1", "x"])).toBe("$&-$1-x");
  });
});

describe("parseShops", () => {
  const parse = (shops: object) =>
    parseShops(extractShops(page(shops)), testRegistry, recordingLogger().log);

  it("keeps events in every language with their raw labels", () => {
    const films = parse({
      1: aribau([event("Anglès", "Español"), event("Japonès", "English"), event("Español", "")]),
    });
    expect(films.map(({ title, showings }) => [title, showings[0]?.labels])).toEqual([
      ["Film", { audio: "Anglès", subtitles: "Español" }],
      ["Film", { audio: "Japonès", subtitles: "English" }],
      ["Film", { audio: "Español" }],
    ]);
    expect(films[2]?.showings[0]?.audio_lang).toBe("other");
  });

  it("books by the template only when it has three slots and the shop has a code", () => {
    const url = (shop: object) =>
      parse({ 1: aribau([event("English", "")], shop) })[0]?.showings[0]?.booking_url;
    expect(url({})).toBe("https://t.test/?perfCode=187518&language=ENG&theatre=BAL-ARIBAU");
    expect(url({ shop_url: "https://t.test/?perfCode=%s&language=%s" })).toBeUndefined();
    expect(url({ code: "" })).toBeUndefined();
  });

  it("skips a shop it can't name, and logs the labels it was given", () => {
    const { log, events } = recordingLogger();
    const films = parseShops(
      extractShops(page({ 1: { label: "NOWHERE", slug: "/x", events: [event("English", "")] } })),
      testRegistry,
      log,
    );
    expect(films).toEqual([]);
    expect(events[0]).toEqual({
      event: "unrecognized_cinema_labels",
      fields: { provider: "secondary", labels: ["/x", "NOWHERE"] },
    });
  });

  it("ignores events without a title or performances, and unreadable performances", () => {
    const bare = { ...event("English", ""), performances: [] };
    const bad = { ...event("English", ""), performances: [{ schedule_date: "2026", time: "x" }] };
    expect(
      parse({ 1: aribau([bare, { ...event("English", ""), name: " " }, bad, "text"]) }),
    ).toEqual([]);
  });
});

describe("legacyEnglishOnly", () => {
  it("keeps English audio or English subtitles, by the legacy needles", () => {
    const shops = {
      1: aribau([
        event("Anglès", "", "audio"),
        event("Japonès", "English", "subs"),
        event("Ingles", "", "unaccented"),
        // The legacy needle is unaccented, so the accented spelling is not English to it.
        event("Inglés", "", "accented"),
        event("Español", "", "dubbed"),
      ]),
    };
    const kept = legacyEnglishOnly(
      parseShops(extractShops(page(shops)), testRegistry, recordingLogger().log),
    );
    expect(kept.map(({ title }) => title)).toEqual(["audio", "subs", "unaccented"]);
  });
});

describe("secondaryProvider", () => {
  it("applies the legacy step, asks with the 20 s timeout and keeps the entry page", async () => {
    const { fetcher, requests } = stubFetcher({
      [LISTINGS]: page({
        1: aribau([event("English", "", "kept"), event("Español", "", "dropped")]),
      }),
    });
    const result = await secondaryProvider({ listingsUrl: LISTINGS }).fetch(context(fetcher));
    expect(result.films.map(({ title }) => title)).toEqual(["kept"]);
    expect(requests).toEqual([{ url: LISTINGS, timeoutMs: 20_000 }]);
    expect(result.entry?.status).toBe(200);
  });

  it("fails without a listings URL", async () => {
    await expect(
      secondaryProvider({ listingsUrl: undefined }).fetch(context(stubFetcher({}).fetcher)),
    ).rejects.toThrow("SECONDARY_LISTINGS_URL");
  });
});
