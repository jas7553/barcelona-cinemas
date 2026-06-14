import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Listings } from "./types";
import { formatDayLabel, formatRuntime, transformResponse, haversineKm, formatLanguage, buildIcs, subtitleBadge } from "./utils";

describe("subtitleBadge", () => {
  it("shows English for English audio regardless of subs", () => {
    expect(subtitleBadge({ audio_lang: "en", subtitle_lang: "es" })).toBe("English");
    expect(subtitleBadge({ audio_lang: "en" })).toBe("English");
  });
  it("shows the subtitle language for foreign audio", () => {
    expect(subtitleBadge({ audio_lang: "other", subtitle_lang: "en" })).toBe("English subs");
    expect(subtitleBadge({ audio_lang: "other", subtitle_lang: "es" })).toBe("Spanish subs");
    expect(subtitleBadge({ subtitle_lang: "ca" })).toBe("Catalan subs");
  });
  it("returns null when unknown", () => {
    expect(subtitleBadge({})).toBeNull();
    expect(subtitleBadge({ audio_lang: null, subtitle_lang: null })).toBeNull();
    expect(subtitleBadge({ audio_lang: "other" })).toBeNull();
  });
});

describe("buildIcs", () => {
  const base = { title: "Dune", location: "Cinemes Verdi, Carrer de Verdi 32", date: "2026-06-15", time: "21:30" };

  it("emits a valid single-event VCALENDAR with the core fields", () => {
    const ics = buildIcs({ ...base, runtimeMinutes: 90 });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("SUMMARY:Dune");
    expect(ics).toMatch(/UID:.+@barcelona-movie-database/);
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    // CRLF line endings per RFC 5545.
    expect(ics).toContain("\r\n");
  });

  it("sets DTEND to start + runtime", () => {
    const ics = buildIcs({ ...base, runtimeMinutes: 90 });
    expect(ics).toContain("DTSTART:20260615T213000");
    expect(ics).toContain("DTEND:20260615T230000"); // 21:30 + 90m = 23:00
  });

  it("falls back to a 120-minute event when runtime is null", () => {
    const ics = buildIcs({ ...base, runtimeMinutes: null });
    expect(ics).toContain("DTSTART:20260615T213000");
    expect(ics).toContain("DTEND:20260615T233000"); // 21:30 + 120m = 23:30
  });

  it("rolls the end date over midnight", () => {
    const ics = buildIcs({ ...base, time: "23:30", runtimeMinutes: 120 });
    expect(ics).toContain("DTSTART:20260615T233000");
    expect(ics).toContain("DTEND:20260616T013000");
  });

  it("escapes commas in TEXT fields", () => {
    const ics = buildIcs({ ...base, title: "Dune, Part Two", runtimeMinutes: 90 });
    expect(ics).toContain("SUMMARY:Dune\\, Part Two");
    expect(ics).toContain("LOCATION:Cinemes Verdi\\, Carrer de Verdi 32");
  });
});

describe("formatLanguage", () => {
  it("maps ISO codes to English names", () => {
    expect(formatLanguage("fr")).toBe("French");
    expect(formatLanguage("en")).toBe("English");
    expect(formatLanguage("ja")).toBe("Japanese");
  });
  it("returns null for missing input", () => {
    expect(formatLanguage(null)).toBeNull();
    expect(formatLanguage(undefined)).toBeNull();
    expect(formatLanguage("")).toBeNull();
  });
  it("returns null for unrecognised codes", () => {
    expect(formatLanguage("zz")).toBeNull();
  });
});

describe("formatRuntime", () => {
  it("formats minutes only", () => expect(formatRuntime(45)).toBe("45m"));
  it("formats hours only", () => expect(formatRuntime(120)).toBe("2h"));
  it("formats hours and minutes", () => expect(formatRuntime(157)).toBe("2h 37m"));
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
          address: "Carrer de Verdi, 32",
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

  it("preserves director and cast on transformed movies", () => {
    vi.setSystemTime(new Date("2026-03-29T10:00:00"));
    const listings: Listings = {
      generated_at: "2026-03-29T09:00:00Z",
      stale: false,
      theaters: [
        {
          id: "verdi", name: "Cinemes Verdi", address: "Carrer de Verdi, 32",
          neighborhood: "Gracia", website_url: "", maps_url: "", lat: null, lng: null,
        },
      ],
      movies: [
        {
          id: "movie-1", title: "Dune", year: 2024, runtime_minutes: 166,
          poster_url: null, backdrop_url: null, trailer_url: null, genres: [],
          rating: 8.2, synopsis: "", links: { imdb: null, imdb_id: null },
          director: "Denis Villeneuve", cast: ["Timothée Chalamet", "Zendaya"],
          original_lang: "en",
          showtimes: [{ theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo", audio_lang: "other", subtitle_lang: "es" }],
        },
      ],
    };

    const [movie] = transformResponse(listings);
    expect(movie.director).toBe("Denis Villeneuve");
    expect(movie.cast).toEqual(["Timothée Chalamet", "Zendaya"]);
    expect(movie.original_lang).toBe("en");
    expect(movie.showtimes[0].audio_lang).toBe("other");
    expect(movie.showtimes[0].subtitle_lang).toBe("es");
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
          address: "Carrer de Verdi, 32",
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
          address: "Carrer de Verdi, 32",
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

