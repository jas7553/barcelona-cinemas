import { describe, expect, it } from "vitest";
import { buildFixture } from "../fixture/build.ts";
import { Listings, type Cinema, type Film, type Showing } from "./listings.ts";

const valid = buildFixture(new Date("2026-11-23T18:00:00+01:00"));

function doc(): Listings {
  return Listings.parse(JSON.parse(JSON.stringify(valid)));
}

function issues(value: unknown): { path: string; message: string }[] {
  const result = Listings.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item ${index}`);
  return item;
}

function film(d: Listings, id: string): Film {
  const found = d.films.find((f) => f.id === id);
  if (found === undefined) throw new Error(`no film ${id}`);
  return found;
}

const cinema = (d: Listings, index = 0): Cinema => at(d.cinemas, index);
const showing = (d: Listings): Showing => at(at(d.films, 0).showings, 0);

it("accepts the fixture", () => {
  expect(issues(valid)).toEqual([]);
});

it("round-trips through JSON to an equal value", () => {
  const parsed = Listings.parse(JSON.parse(JSON.stringify(valid)));
  expect(parsed).toStrictEqual(valid);
});

describe("document invariants", () => {
  it("rejects a showing at an unknown cinema", () => {
    const d = doc();
    showing(d).cinema_id = "nowhere";
    expect(issues(d)).toEqual([
      { path: "films.0.showings.0.cinema_id", message: "unknown cinema nowhere" },
    ]);
  });

  it("rejects duplicate cinema ids", () => {
    const d = doc();
    d.cinemas.push({ ...cinema(d), code: "Zz" });
    expect(issues(d)).toEqual([{ path: "cinemas.6.id", message: "duplicate cinema id" }]);
  });

  it("rejects duplicate cinema codes", () => {
    const d = doc();
    cinema(d, 1).code = cinema(d).code;
    expect(issues(d)).toEqual([{ path: "cinemas.1.code", message: "duplicate cinema code" }]);
  });

  it("rejects duplicate film ids", () => {
    const d = doc();
    d.films.push(at(doc().films, 0));
    expect(issues(d)).toEqual([
      { path: `films.${d.films.length - 1}.id`, message: "duplicate film id" },
    ]);
  });

  it("rejects a previous id that is another film's current id", () => {
    const d = doc();
    film(d, "900008").previous_ids = ["mirall-trencat"];
    expect(issues(d)).toEqual([
      { path: "films.7.previous_ids.0", message: "previous id is a current film id" },
    ]);
  });

  it("rejects a previous id that is the film's own id", () => {
    const d = doc();
    film(d, "900008").previous_ids = ["900008"];
    expect(issues(d)).toEqual([
      { path: "films.7.previous_ids.0", message: "previous id is a current film id" },
    ]);
  });

  it("rejects a previous id claimed by two films", () => {
    const d = doc();
    film(d, "900007").previous_ids = ["paper-moons"];
    expect(issues(d)).toEqual([
      { path: "films.7.previous_ids.0", message: "previous id claimed by two films" },
    ]);
  });

  it("rejects a cinema with showings but no published_through", () => {
    const d = doc();
    delete cinema(d).published_through;
    expect(issues(d)).toEqual([
      {
        path: "cinemas.0.published_through",
        message: "a cinema with showings needs published_through",
      },
    ]);
  });

  it("rejects published_through before the cinema day of the cinema's latest showing", () => {
    const d = doc();
    const balmes = cinema(d);
    expect(balmes.published_through).toBe("2026-12-13");
    film(d, "900001").showings.push({
      cinema_id: balmes.id,
      starts_at: "2026-12-14T00:30+01:00",
      version: "original",
      audio: "en",
    });
    expect(issues(d)).toEqual([]);
    film(d, "900001").showings.push({
      cinema_id: balmes.id,
      starts_at: "2026-12-14T06:00+01:00",
      version: "original",
      audio: "en",
    });
    expect(issues(d)).toEqual([
      {
        path: "cinemas.0.published_through",
        message: "published_through is before the cinema day of its latest showing",
      },
    ]);
  });

  it("accepts a cinema with no showings and no published_through or checked_at", () => {
    const d = doc();
    const girona: Cinema = { ...cinema(d), id: "girona", code: "Gi" };
    delete girona.published_through;
    delete girona.checked_at;
    d.cinemas.push(girona);
    expect(issues(d)).toEqual([]);
  });

  it("rejects published_through without checked_at", () => {
    const d = doc();
    delete cinema(d).checked_at;
    expect(issues(d)).toEqual([
      { path: "cinemas.0.checked_at", message: "published_through needs checked_at" },
    ]);
  });

  it("rejects checked_at after generated_at", () => {
    const d = doc();
    cinema(d).checked_at = new Date(Date.parse(d.generated_at) + 1000).toISOString();
    expect(issues(d)).toEqual([
      { path: "cinemas.0.checked_at", message: "checked_at is after generated_at" },
    ]);
  });

  it("rejects any other schema_version", () => {
    expect(issues({ ...doc(), schema_version: 1 }).map((i) => i.path)).toEqual(["schema_version"]);
  });

  it("rejects unknown keys", () => {
    expect(issues({ ...doc(), extra: true }).map((i) => i.path)).toEqual([""]);
  });
});

describe("film invariants", () => {
  it("rejects a matched film whose id isn't its tmdb_id", () => {
    const d = doc();
    film(d, "900001").tmdb_id = 42;
    expect(issues(d).map((i) => i.path)).toEqual(["films.0.id"]);
  });

  it("rejects an unmatched film with a numeric id", () => {
    const d = doc();
    film(d, "mirall-trencat").id = "1917";
    expect(issues(d).map((i) => i.path)).toEqual(["films.3.id"]);
  });

  it("rejects a duplicate showing", () => {
    const d = doc();
    const f = film(d, "900001");
    f.showings.push({ ...showing(d) });
    expect(issues(d)).toEqual([
      { path: `films.0.showings.${f.showings.length - 1}`, message: "duplicate showing" },
    ]);
  });

  it("accepts the same time at one cinema in both versions", () => {
    const d = doc();
    film(d, "900001").showings.push({ ...showing(d), version: "dubbed", audio: "other" });
    expect(issues(d)).toEqual([]);
  });

  it.each([
    ["an empty list", { genres: [] }],
    ["an empty string", { tagline: "" }],
    ["surrounding whitespace", { title: " Paper Moons" }],
    ["null for a missing value", { tagline: null }],
    ["a poster URL instead of a TMDb path", { poster_path: "https://example.com/p.jpg" }],
    ["a trailer URL instead of a YouTube key", { trailer_youtube_key: "https://youtu.be/x" }],
    ["a malformed IMDb id", { imdb_id: "9000001" }],
    ["a rating with no votes", { rating: { average: 0, votes: 0 } }],
    ["missing showings", { showings: undefined }],
  ])("rejects %s", (_, patch) => {
    const d = doc();
    Object.assign(film(d, "900008"), patch);
    expect(issues(d)).not.toEqual([]);
  });
});

describe("ids and formats", () => {
  it.each(["550", "mirall-trencat", "1917-a", "2001-a-space-odyssey"])(
    "accepts film id %s",
    (id) => {
      const d = doc();
      const f = film(d, "mirall-trencat");
      f.id = id;
      if (/^\d+$/.test(id)) f.tmdb_id = Number(id);
      expect(issues(d)).toEqual([]);
    },
  );

  it.each(["0550", "Mirall", "mirall--trencat", "-mirall", "mirall_trencat", ""])(
    "rejects film id %j",
    (id) => {
      const d = doc();
      film(d, "mirall-trencat").id = id;
      expect(issues(d)).not.toEqual([]);
    },
  );

  it.each(["B", "Bal", "ba", "B1"])("rejects cinema code %j", (code) => {
    const d = doc();
    cinema(d).code = code;
    expect(issues(d).map((i) => i.path)).toEqual(["cinemas.0.code"]);
  });

  it("rejects an unknown chain", () => {
    const d = doc();
    Object.assign(cinema(d), { chain: "Filmax" });
    expect(issues(d).map((i) => i.path)).toEqual(["cinemas.0.chain"]);
  });

  it.each(["2026-02-30", "2026-1-05", "20261105"])("rejects date %j", (date) => {
    const d = doc();
    cinema(d).published_through = date;
    expect(issues(d).map((i) => i.path)).toEqual(["cinemas.0.published_through"]);
  });

  it.each(["2026-11-23T17:00:00", "2026-11-23 17:00:00Z", "yesterday"])(
    "rejects instant %j",
    (instant) => {
      expect(issues({ ...doc(), generated_at: instant }).map((i) => i.path)).toContain(
        "generated_at",
      );
    },
  );

  it.each([
    ["winter", "2026-12-01T21:05+01:00"],
    ["summer", "2026-07-01T21:00+02:00"],
    ["after midnight", "2026-11-24T00:30+01:00"],
    ["the first 02:30 when clocks go back", "2026-10-25T02:30+02:00"],
    ["the second 02:30 when clocks go back", "2026-10-25T02:30+01:00"],
    ["03:30 when clocks go forward", "2026-03-29T03:30+02:00"],
  ])("accepts starts_at in %s", (_, startsAt) => {
    const d = doc();
    showing(d).starts_at = startsAt;
    expect(issues(d)).toEqual([]);
  });

  it.each([
    ["UTC", "2026-11-23T20:00Z"],
    ["the wrong Madrid offset", "2026-11-23T21:00+02:00"],
    ["no offset", "2026-11-23T21:00"],
    ["seconds", "2026-11-23T21:00:00+01:00"],
    ["a time skipped when clocks go forward", "2026-03-29T02:30+01:00"],
    ["an impossible date", "2026-02-30T21:00+01:00"],
  ])("rejects starts_at in %s", (_, startsAt) => {
    const d = doc();
    showing(d).starts_at = startsAt;
    expect(issues(d).map((i) => i.path)).toEqual(["films.0.showings.0.starts_at"]);
  });

  it.each([
    ["Google place id", { place_id: "Balmes" }],
    ["website", { website_url: "javascript:alert(1)" }],
    ["latitude", { lat: 2.1386, lng: 41.4072 }],
  ])("rejects a bad cinema %s", (_, patch) => {
    const d = doc();
    Object.assign(cinema(d), patch);
    expect(issues(d)).not.toEqual([]);
  });

  it("rejects a booking link that isn't http(s)", () => {
    const d = doc();
    showing(d).booking_url = "javascript:alert(1)";
    expect(issues(d).map((i) => i.path)).toEqual(["films.0.showings.0.booking_url"]);
  });
});
