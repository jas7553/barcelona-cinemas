import { describe, expect, it } from "vitest";
import { listData, renderPage, sitePages } from "./entry-server";
import type { Listings } from "./types";

const listings: Listings = { generated_at: "2026-10-04T08:19:00Z", theaters: [], movies: [] };
const renderedAt = "2026-10-04T10:19:00Z";

function page(name: string) {
  const found = sitePages(listings, renderedAt).find((p) => p.data.page === name);
  if (!found) throw new Error(`no ${name} page`);
  return found;
}

describe("sitePages", () => {
  it("carries the listings' age into every payload", () => {
    for (const { data } of sitePages(listings, renderedAt)) {
      expect(data).toMatchObject({ renderedAt, generatedAt: listings.generated_at });
      expect(data).not.toHaveProperty("stale");
    }
  });

  it("writes the 404 where CloudFront's error response expects it", () => {
    expect(page("not-found").path).toBe("404.html");
  });
});

describe("renderPage", () => {
  it("renders Privacy with a trailing-slash canonical URL", () => {
    const out = renderPage(page("privacy").data, "https://example.com");
    expect(out.title).toBe("Privacy · Barcelona This Week");
    expect(out.headExtra).toContain('rel="canonical" href="https://example.com/privacy/"');
    expect(out.headExtra).not.toContain("noindex");
    expect(out.html).toContain("Forget all of it");
  });

  it("renders the 404 as noindex with no canonical", () => {
    const out = renderPage(page("not-found").data, "https://example.com");
    expect(out.html).toContain("Not showing.");
    expect(out.headExtra).toContain('name="robots" content="noindex"');
    expect(out.headExtra).not.toContain("canonical");
  });

  it("states the data age against the render instant, so hydration matches", () => {
    expect(renderPage(page("privacy").data).html).toContain("Updated 2 h ago");
  });

  it("puts both Home pill labels in the markup for the pre-paint CSS to choose between", () => {
    const { html } = renderPage(page("privacy").data);
    expect(html).toContain('<span class="if-home">Home</span>');
    expect(html).toContain('<span class="if-no-home">Set home</span>');
  });

  it("never emits a style attribute, which the CSP would block", () => {
    for (const { data } of sitePages(listings, renderedAt)) {
      expect(renderPage(data).html).not.toMatch(/\sstyle=/);
    }
  });
});

const full: Listings = {
    ...listings,
    theaters: [
      { id: "verdi", name: "Cines Verdi", address: "", neighborhood: "Gràcia", website_url: "", maps_url: "", lat: 41.4, lng: 2.15 },
      { id: "unused", name: "Unused", address: "", neighborhood: "", website_url: "", maps_url: "", lat: null, lng: null },
    ],
    movies: [
      {
        id: "1",
        title: "Aftersun",
        year: 2022,
        runtime_minutes: 102,
        poster_url: null,
        backdrop_url: null,
        trailer_url: null,
        genres: ["Drama"],
        rating: 7.7,
        synopsis: "Not in any list payload.",
        imdb_id: null,
        showtimes: [
          { theater_id: "verdi", date: "2026-10-04", time: "21:30", booking_url: "https://b/1", audio_lang: "en", subtitle_lang: null, premium_format: null },
          { theater_id: "verdi", date: "2026-10-20", time: "21:30" },
        ],
      },
    ],
  };

describe("list pages", () => {
  it("renders This week at the root and a page for each of the next 8 days", () => {
    const paths = sitePages(full, renderedAt).map((p) => p.path);
    expect(paths).toContain("index.html");
    expect(paths.filter((p) => p.startsWith("day/"))).toEqual(
      ["04", "05", "06", "07", "08", "09", "10", "11"].map((d) => `day/2026-10-${d}.html`),
    );
  });

  it("carries only timetable fields on This week, and the ticket's on a Day", () => {
    const week = listData(full, ["2026-10-04"], false);
    expect(week.films[0]).not.toHaveProperty("synopsis");
    expect(week.films[0].showtimes).toEqual([{ theater_id: "verdi", date: "2026-10-04", time: "21:30" }]);
    const day = listData(full, ["2026-10-04"], true);
    expect(day.films[0].showtimes).toEqual([
      { theater_id: "verdi", date: "2026-10-04", time: "21:30", booking_url: "https://b/1", audio_lang: "en" },
    ]);
    expect(day.theaters.map((t) => t.id)).toEqual(["verdi"]);
  });

  it("counts every published day in the calendar, in range or not", () => {
    expect(listData(full, ["2026-10-05"], false)).toMatchObject({
      films: [],
      calendar: [
        { date: "2026-10-04", cinemas: 1, last: "21:30" },
        { date: "2026-10-20", cinemas: 1, last: "21:30" },
      ],
    });
  });

  it("titles the home page for search and names the site in WebSite ld+json", () => {
    const out = renderPage(page("week").data, "https://example.com");
    expect(out.title).toBe("Barcelona This Week · English-language movies at Barcelona cinemas");
    const ld = out.headExtra.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1];
    expect(JSON.parse(ld)).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Barcelona This Week",
      url: "https://example.com/",
    });
  });

  it("titles a Day page by its date, with a trailing-slash canonical", () => {
    const day = sitePages(full, renderedAt).find((p) => p.path === "day/2026-10-06.html")!;
    const out = renderPage(day.data, "https://example.com");
    expect(out.title).toBe("Tuesday 6 October · Barcelona This Week");
    expect(out.headExtra).toContain('rel="canonical" href="https://example.com/day/2026-10-06/"');
  });

  it("never emits a style attribute on list pages either", () => {
    for (const { data } of sitePages(full, renderedAt)) {
      expect(renderPage(data).html).not.toMatch(/\sstyle=/);
    }
  });
});

describe("film pages", () => {
  const withEnded: Listings = {
    ...full,
    movies: full.movies.map((m) => ({
      ...m,
      synopsis: "A spoiler-laden synopsis.",
      cast: ["A", "B", "C", "D", "E"],
      imdb_id: "tt1",
    })),
    ended_movies: [{ ...full.movies[0], id: "9", title: "Over", showtimes: [] }],
  };
  const pages = sitePages(withEnded, renderedAt);

  it("renders an undated page and one per rendered day, and only the undated one for an ended film", () => {
    const paths = pages.map((p) => p.path).filter((p) => p.startsWith("film/"));
    expect(paths.filter((p) => p.startsWith("film/1"))).toHaveLength(9);
    expect(paths).toContain("film/1.html");
    expect(paths).toContain("film/1/2026-10-11.html");
    expect(paths.filter((p) => p.startsWith("film/9"))).toEqual(["film/9.html"]);
  });

  it("carries the ticket's fields for showings in range, the first 4 of the cast, and the outside links", () => {
    const data = pages.find((p) => p.path === "film/1.html")!.data;
    if (data.page !== "film") throw new Error("not a film page");
    expect(data.film.showtimes).toEqual([
      { theater_id: "verdi", date: "2026-10-04", time: "21:30", booking_url: "https://b/1", audio_lang: "en" },
    ]);
    expect(data.film.cast).toEqual(["A", "B", "C", "D"]);
    expect(data.film.imdb).toBe("https://www.imdb.com/title/tt1");
    expect(data.film.letterboxd).toBe("https://letterboxd.com/imdb/tt1/");
    expect(data.theaters.map((t) => t.id)).toEqual(["verdi"]);
  });

  it("falls back to a Letterboxd search and no IMDb link without an IMDb id", () => {
    const data = pages.find((p) => p.path === "film/9.html")!.data;
    if (data.page !== "film") throw new Error("not a film page");
    expect(data.film.imdb).toBeNull();
    expect(data.film.letterboxd).toBe("https://letterboxd.com/search/Over%202022/");
  });

  it("keeps the synopsis out of share previews and points dated pages at the undated one", () => {
    const dated = renderPage(pages.find((p) => p.path === "film/1/2026-10-05.html")!.data, "https://x.test");
    expect(dated.title).toBe("Aftersun · Barcelona This Week");
    expect(dated.headExtra).toContain('content="Aftersun · 2022 · Drama"');
    expect(dated.headExtra).not.toContain("spoiler");
    expect(dated.headExtra).toContain('rel="canonical" href="https://x.test/film/1/"');
    expect(dated.headExtra).not.toContain("ld+json");
    expect(renderPage(pages.find((p) => p.path === "film/1.html")!.data, "https://x.test").headExtra).toContain(
      "ScreeningEvent",
    );
  });

  it("marks an ended film's page noindex", () => {
    const over = renderPage(pages.find((p) => p.path === "film/9.html")!.data, "https://x.test");
    expect(over.headExtra).toContain('name="robots" content="noindex"');
    expect(over.headExtra).not.toContain("canonical");
    expect(over.html).toContain("No more showings");
  });

  it("never emits a style attribute", () => {
    for (const { data } of pages.filter((p) => p.data.page === "film")) {
      expect(renderPage(data).html).not.toMatch(/\sstyle=/);
    }
  });
});

describe("cinema pages", () => {
  const pages = sitePages(full, renderedAt);

  it("renders a week view and a Day view per rendered day for every cinema, and the index", () => {
    const paths = pages.map((p) => p.path);
    expect(paths.filter((p) => p.startsWith("cinema/verdi"))).toHaveLength(9);
    expect(paths).toContain("cinema/unused.html");
    expect(paths).toContain("cinemas.html");
  });

  it("carries this cinema's showings in range, with what the ticket needs", () => {
    const data = pages.find((p) => p.path === "cinema/verdi.html")!.data;
    if (data.page !== "cinema") throw new Error("not a cinema page");
    expect(data.films.map((f) => f.showtimes)).toEqual([
      [{ theater_id: "verdi", date: "2026-10-04", time: "21:30", booking_url: "https://b/1", audio_lang: "en" }],
    ]);
  });

  it("gives the index each film's last showing per cinema", () => {
    const data = pages.find((p) => p.path === "cinemas.html")!.data;
    if (data.page !== "cinemas") throw new Error("not the index");
    expect(data.lastShowings).toEqual({ verdi: ["2026-10-04T21:30"] });
  });

  it("points a cinema's Day views at its week view", () => {
    const out = renderPage(pages.find((p) => p.path === "cinema/verdi/2026-10-05.html")!.data, "https://x.test");
    expect(out.title).toBe("Cines Verdi · Barcelona This Week");
    expect(out.headExtra).toContain('rel="canonical" href="https://x.test/cinema/verdi/"');
  });

  it("never emits a style attribute", () => {
    for (const { data } of pages.filter((p) => p.data.page === "cinema" || p.data.page === "cinemas")) {
      expect(renderPage(data).html).not.toMatch(/\sstyle=/);
    }
  });
});
