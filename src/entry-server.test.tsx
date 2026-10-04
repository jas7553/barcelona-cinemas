import { describe, expect, it } from "vitest";
import { listData, renderPage, sitePages } from "./entry-server";
import type { Listings } from "./types";

const listings: Listings = { generated_at: "2026-10-04T08:19:00Z", stale: false, theaters: [], movies: [] };
const renderedAt = "2026-10-04T10:19:00Z";

function page(name: string) {
  const found = sitePages(listings, renderedAt).find((p) => p.data.page === name);
  if (!found) throw new Error(`no ${name} page`);
  return found;
}

describe("sitePages", () => {
  it("carries the listings' age into every payload", () => {
    for (const { data } of sitePages(listings, renderedAt)) {
      expect(data).toMatchObject({ renderedAt, generatedAt: listings.generated_at, stale: false });
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

describe("list pages", () => {
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
        links: { imdb: null, imdb_id: null },
        showtimes: [
          { theater_id: "verdi", date: "2026-10-04", time: "21:30", language: "vo", booking_url: "https://b/1", audio_lang: "en", subtitle_lang: null, premium_format: null },
          { theater_id: "verdi", date: "2026-10-20", time: "21:30", language: "vo" },
        ],
      },
    ],
  };

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
