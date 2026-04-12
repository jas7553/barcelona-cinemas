import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Listings, TransformedMovie } from "./types";
import { formatDayLabel, formatRuntime, relativeTime, transformResponse, haversineKm, smartSort } from "./utils";

describe("formatRuntime", () => {
  it("formats minutes only", () => expect(formatRuntime(45)).toBe("45m"));
  it("formats hours only", () => expect(formatRuntime(120)).toBe("2h"));
  it("formats hours and minutes", () => expect(formatRuntime(157)).toBe("2h 37m"));
});

describe("relativeTime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns 'just now' for under 1 minute", () => {
    vi.setSystemTime(new Date("2026-03-28T10:00:00Z"));
    expect(relativeTime("2026-03-28T09:59:45Z")).toBe("just now");
  });

  it("returns minutes ago", () => {
    vi.setSystemTime(new Date("2026-03-28T10:05:00Z"));
    expect(relativeTime("2026-03-28T10:00:00Z")).toBe("5 minutes ago");
  });

  it("uses singular for 1 minute", () => {
    vi.setSystemTime(new Date("2026-03-28T10:01:00Z"));
    expect(relativeTime("2026-03-28T10:00:00Z")).toBe("1 minute ago");
  });

  it("returns hours ago", () => {
    vi.setSystemTime(new Date("2026-03-28T13:00:00Z"));
    expect(relativeTime("2026-03-28T10:00:00Z")).toBe("3 hours ago");
  });

  it("returns days ago", () => {
    vi.setSystemTime(new Date("2026-03-30T10:00:00Z"));
    expect(relativeTime("2026-03-28T10:00:00Z")).toBe("2 days ago");
  });
});

describe("formatDayLabel", () => {
  it("returns 'Today' for offset 0", () => {
    expect(formatDayLabel(0, new Date("2026-03-28"))).toBe("Today");
  });

  it("returns 'Tomorrow' for offset 1", () => {
    expect(formatDayLabel(1, new Date("2026-03-29"))).toBe("Tomorrow");
  });

  it("returns formatted weekday for offset >= 2", () => {
    const label = formatDayLabel(2, new Date("2026-03-30"));
    expect(label).toMatch(/Mon/);
  });
});

describe("transformResponse", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("preserves poster_url on transformed movies", () => {
    vi.setSystemTime(new Date("2026-03-29T10:00:00"));
    const listings: Listings = {
      generated_at: "2026-03-29T09:00:00Z",
      stale: false,
      theaters: [
        {
          id: "verdi",
          name: "Cinemes Verdi",
          neighborhood: "Gracia",
          website_url: "https://cinesesverdi.com",
          maps_url: "https://maps.google.com/?q=Verdi",
          lat: null,
          lng: null,
        },
      ],
      movies: [
        {
          id: "movie-1",
          title: "Project Hail Mary",
          year: 2025,
          runtime_minutes: 157,
          poster_url: "https://image.tmdb.org/t/p/w342/project-hail-mary.jpg",
          backdrop_url: null,
          trailer_url: null,
          genres: ["Sci-Fi"],
          rating: 8.2,
          synopsis: "A lone astronaut races to save humanity.",
          links: { imdb: null, imdb_id: null },
          showtimes: [
            { theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" },
          ],
        },
      ],
    };

    const [movie] = transformResponse(listings);
    expect(movie.poster_url).toBe("https://image.tmdb.org/t/p/w342/project-hail-mary.jpg");
  });

  it("excludes showtimes whose datetime has already passed", () => {
    // System time: 2026-03-29 at 20:00 — the 18:00 show is already over
    vi.setSystemTime(new Date("2026-03-29T20:00:00"));
    const listings: Listings = {
      generated_at: "2026-03-29T09:00:00Z",
      stale: false,
      theaters: [
        {
          id: "verdi",
          name: "Cinemes Verdi",
          neighborhood: "Gracia",
          website_url: "https://cinesesverdi.com",
          maps_url: "",
          lat: null,
          lng: null,
        },
      ],
      movies: [
        {
          id: "movie-1",
          title: "Dead Film",
          year: 2025,
          runtime_minutes: 90,
          poster_url: null,
          backdrop_url: null,
          trailer_url: null,
          genres: [],
          rating: null,
          synopsis: "",
          links: { imdb: null, imdb_id: null },
          showtimes: [
            { theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" },
          ],
        },
      ],
    };

    const result = transformResponse(listings);
    expect(result).toHaveLength(0);
  });

  it("keeps only future showtimes when a film has a mix of past and future", () => {
    vi.setSystemTime(new Date("2026-03-29T16:00:00"));
    const listings: Listings = {
      generated_at: "2026-03-29T09:00:00Z",
      stale: false,
      theaters: [
        {
          id: "verdi",
          name: "Cinemes Verdi",
          neighborhood: "Gracia",
          website_url: "",
          maps_url: "",
          lat: null,
          lng: null,
        },
      ],
      movies: [
        {
          id: "movie-1",
          title: "Mixed Times",
          year: 2025,
          runtime_minutes: 90,
          poster_url: null,
          backdrop_url: null,
          trailer_url: null,
          genres: [],
          rating: null,
          synopsis: "",
          links: { imdb: null, imdb_id: null },
          showtimes: [
            { theater_id: "verdi", date: "2026-03-29", time: "12:00", language: "vo" }, // past
            { theater_id: "verdi", date: "2026-03-29", time: "20:00", language: "vo" }, // future
          ],
        },
      ],
    };

    const [movie] = transformResponse(listings);
    expect(movie.showtimes).toHaveLength(1);
    expect(movie.showtimes[0].time).toBe("20:00");
  });
});

function makeMovie(overrides: Partial<TransformedMovie> & { id: string; showtimes: TransformedMovie["showtimes"] }): TransformedMovie {
  return {
    title: "Test Film",
    year: 2026,
    runtime_minutes: 90,
    runtimeLabel: "1h 30m",
    poster_url: null,
    backdrop_url: null,
    trailer_url: null,
    genres: [],
    rating: 7.0,
    synopsis: "",
    links: { imdb: null, imdb_id: null },
    ...overrides,
  };
}

describe("haversineKm", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineKm(41.4035, 2.1580, 41.4035, 2.1580)).toBeCloseTo(0, 3);
  });

  it("returns ~0.1 km for nearby points in Barcelona", () => {
    // Verdi cinema to Mooby Bosque — roughly 100m apart
    const d = haversineKm(41.4035, 2.1580, 41.4029, 2.1570);
    expect(d).toBeGreaterThan(0.05);
    expect(d).toBeLessThan(0.3);
  });

  it("returns ~10 km for cross-city points", () => {
    // Verdi (Gràcia) to Filmax (L'Hospitalet)
    const d = haversineKm(41.4035, 2.1580, 41.3610, 2.1073);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(15);
  });
});

describe("smartSort", () => {
  const theater = {
    id: "t1", name: "T1", neighborhood: "A",
    website_url: "", maps_url: "", lat: null, lng: null,
  };
  const showtime = (date = "2099-01-01") => ({
    theater_id: "t1", theater, date, time: "20:00", language: "vo" as const, dayOffset: 1,
  });

  it("excludes hidden film IDs", () => {
    const movies = [
      makeMovie({ id: "a", showtimes: [showtime(), showtime(), showtime()] }),
      makeMovie({ id: "b", showtimes: [showtime()] }),
    ];
    const result = smartSort(movies, new Set(["a"]));
    expect(result.map(m => m.id)).toEqual(["b"]);
  });

  it("places last-chance (1 screening remaining) films first", () => {
    const movies = [
      makeMovie({ id: "popular", rating: 8.0, showtimes: [showtime(), showtime(), showtime(), showtime()] }),
      makeMovie({ id: "last-chance", rating: 5.0, showtimes: [showtime()] }),
    ];
    const result = smartSort(movies, new Set());
    expect(result[0].id).toBe("last-chance");
  });

  it("places highly-rated (≥7.5) films before widely-screened", () => {
    const movies = [
      makeMovie({ id: "wide", rating: 6.0, showtimes: [showtime(), showtime(), showtime(), showtime(), showtime()] }),
      makeMovie({ id: "rated", rating: 8.0, showtimes: [showtime(), showtime(), showtime()] }),
    ];
    const result = smartSort(movies, new Set());
    expect(result[0].id).toBe("rated");
  });

  it("breaks ties within tier by rating descending", () => {
    const movies = [
      makeMovie({ id: "lower", rating: 7.0, showtimes: [showtime()] }),
      makeMovie({ id: "higher", rating: 8.0, showtimes: [showtime()] }),
    ];
    const result = smartSort(movies, new Set());
    expect(result[0].id).toBe("higher");
  });
});
