import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ListPage from "./ListPage";
import FilmPage from "./FilmPage";
import { renderList, renderFilm, renderPrivacy, filmListings } from "../entry-server";
import type { Listings } from "../types";

function futureDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function sampleListings(): Listings {
  return {
    generated_at: new Date().toISOString(),
    stale: false,
    theaters: [
      {
        id: "verdi",
        name: "Cinemes Verdi",
        address: "Carrer de Verdi, 32",
        neighborhood: "Gràcia",
        website_url: "https://example.com",
        maps_url: "https://maps.google.com/?q=Verdi",
        lat: null,
        lng: null,
      },
    ],
    movies: [
      {
        id: "1",
        title: "Project Hail Mary",
        year: 2025,
        runtime_minutes: 157,
        poster_url: null,
        backdrop_url: null,
        trailer_url: null,
        genres: ["Sci-Fi"],
        rating: 8.2,
        vote_count: 4129,
        synopsis: "A lone astronaut must save humanity.",
        links: { imdb: null, imdb_id: null },
        showtimes: [
          { theater_id: "verdi", date: futureDate(2), time: "18:00", language: "vo" },
          { theater_id: "verdi", date: futureDate(2), time: "20:30", language: "vo" },
        ],
      },
    ],
  };
}

const renderedAt = new Date().toISOString();

describe("ListPage", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("renders film cards from embedded data with no fetch", () => {
    render(<ListPage data={{ renderedAt, listings: sampleListings() }} />);
    expect(screen.getByText("Project Hail Mary")).toBeInTheDocument();
  });

  it("links each card to its film page", () => {
    render(<ListPage data={{ renderedAt, listings: sampleListings() }} />);
    const link = screen.getByRole("link", { name: /Project Hail Mary/ });
    expect(link.getAttribute("href")).toBe("/film/1");
  });
});

describe("FilmPage", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/film/1");
  });

  it("renders the detail view from embedded single-film data", () => {
    const full = sampleListings();
    const narrowed = filmListings(full, "1")!;
    render(<FilmPage data={{ renderedAt, listings: narrowed, filmId: "1" }} />);
    expect(screen.getByRole("heading", { name: "Project Hail Mary" })).toBeInTheDocument();
    expect(screen.getByText(/Showtimes/)).toBeInTheDocument();
  });

  it("shows a not-found state when the film is absent", () => {
    const empty: Listings = { generated_at: renderedAt, stale: false, theaters: [], movies: [] };
    render(<FilmPage data={{ renderedAt, listings: empty, filmId: "999" }} />);
    expect(screen.getByText(/isn't showing/)).toBeInTheDocument();
  });
});

describe("entry-server (SSG)", () => {
  it("renderList produces real markup + site title", () => {
    const out = renderList({ renderedAt, listings: sampleListings() });
    expect(out.title).toBe("Barcelona This Week");
    expect(out.html).toContain("Project Hail Mary");
  });

  it("renderList emits canonical + social cards when given a siteUrl", () => {
    const out = renderList({ renderedAt, listings: sampleListings() }, "https://example.com");
    expect(out.headExtra).toContain('rel="canonical" href="https://example.com/"');
    expect(out.headExtra).toContain('property="og:image" content="https://example.com/apple-touch-icon.png"');
    expect(out.headExtra).toContain('name="twitter:card" content="summary"');
  });

  it("renderFilm produces a per-film title + OpenGraph", () => {
    const narrowed = filmListings(sampleListings(), "1")!;
    const out = renderFilm({ renderedAt, listings: narrowed, filmId: "1" }, "https://example.com");
    expect(out.title).toBe("Project Hail Mary · Barcelona This Week");
    expect(out.headExtra).toContain('property="og:url"');
    expect(out.html).toContain("Project Hail Mary");
  });

  it("renderFilm of a screening film: canonical + ScreeningEvent JSON-LD, no noindex", () => {
    const narrowed = filmListings(sampleListings(), "1")!;
    const out = renderFilm({ renderedAt, listings: narrowed, filmId: "1" }, "https://example.com");
    expect(out.headExtra).toContain('rel="canonical" href="https://example.com/film/1"');
    expect(out.headExtra).toContain('type="application/ld+json"');
    expect(out.headExtra).toContain('"@type":"ScreeningEvent"');
    expect(out.headExtra).toContain('"@type":"Movie"');
    expect(out.headExtra).not.toContain("noindex");
  });

  it("renderFilm JSON-LD includes aggregateRating when rating and vote_count are present", () => {
    const narrowed = filmListings(sampleListings(), "1")!;
    const out = renderFilm({ renderedAt, listings: narrowed, filmId: "1" }, "https://example.com");
    expect(out.headExtra).toContain('"@type":"AggregateRating"');
    expect(out.headExtra).toContain('"ratingCount":4129');
    expect(out.headExtra).toContain('"ratingValue":8.2');
  });

  it("renderFilm JSON-LD omits aggregateRating when vote_count is absent", () => {
    const listings = sampleListings();
    const { vote_count: _removed, ...movieWithoutVoteCount } = listings.movies[0] as typeof listings.movies[0] & { vote_count?: number | null };
    void _removed;
    listings.movies[0] = { ...movieWithoutVoteCount };
    const narrowed = filmListings(listings, "1")!;
    const out = renderFilm({ renderedAt, listings: narrowed, filmId: "1" }, "https://example.com");
    expect(out.headExtra).not.toContain("aggregateRating");
    expect(out.headExtra).not.toContain("AggregateRating");
  });

  it("renderFilm JSON-LD omits aggregateRating when vote_count is 0", () => {
    const listings = sampleListings();
    listings.movies[0] = { ...listings.movies[0], vote_count: 0 };
    const narrowed = filmListings(listings, "1")!;
    const out = renderFilm({ renderedAt, listings: narrowed, filmId: "1" }, "https://example.com");
    expect(out.headExtra).not.toContain("aggregateRating");
    expect(out.headExtra).not.toContain("AggregateRating");
  });

  it("renderFilm of a film with no showtimes is noindex, no canonical, no JSON-LD", () => {
    const noShow: Listings = {
      generated_at: renderedAt,
      stale: false,
      theaters: [],
      movies: [{ ...sampleListings().movies[0], id: "2", showtimes: [] }],
    };
    const out = renderFilm({ renderedAt, listings: noShow, filmId: "2" }, "https://example.com");
    expect(out.headExtra).toContain('name="robots" content="noindex"');
    expect(out.headExtra).not.toContain('rel="canonical"');
    expect(out.headExtra).not.toContain("application/ld+json");
  });

  it("renderPrivacy produces a correct title", () => {
    const out = renderPrivacy();
    expect(out.title).toBe("Privacy · Barcelona This Week");
  });

  it("renderPrivacy emits a canonical link when given a siteUrl", () => {
    const out = renderPrivacy("https://example.com");
    expect(out.headExtra).toContain('rel="canonical" href="https://example.com/privacy"');
  });

  it("renderPrivacy emits an og:url when given a siteUrl", () => {
    const out = renderPrivacy("https://example.com");
    expect(out.headExtra).toContain('property="og:url" content="https://example.com/privacy"');
  });

  it("renderPrivacy is NOT noindex", () => {
    const out = renderPrivacy("https://example.com");
    expect(out.headExtra).not.toContain("noindex");
  });

  it("renderPrivacy html contains key privacy claims", () => {
    const out = renderPrivacy();
    expect(out.html).toContain("No cookies");
    expect(out.html).toContain("No analytics");
    expect(out.html).toContain("btw-dark");
  });

  it("filmListings narrows movies to one and keeps only used theaters", () => {
    const narrowed = filmListings(sampleListings(), "1")!;
    expect(narrowed.movies).toHaveLength(1);
    expect(narrowed.theaters).toHaveLength(1);
    expect(narrowed.theaters[0].id).toBe("verdi");
    expect(filmListings(sampleListings(), "nope")).toBeNull();
  });
});
