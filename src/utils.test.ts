import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Listings, Movie, Showtime } from "./types";
import { formatDayLabel, formatRuntime, transformResponse, haversineKm, formatLanguage, buildIcs, viewingLang, viewingLangLabel, premiumFormatLabel, buildCinemaRows, buildCinemaGroups, buildDaySections, generateDays, dayHorizon, parseSortMode, sortMovies, movieMatchesQuery, normalizeForSearch } from "./utils";

/** One Verdi theater and one movie; override only the movie fields a test asserts on. */
function sampleListings(showtimes: Showtime[], movie: Partial<Movie> = {}): Listings {
  return {
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
        poster_url: null,
        backdrop_url: null,
        trailer_url: null,
        genres: ["Sci-Fi"],
        rating: 8.2,
        synopsis: "A lone astronaut races to save humanity.",
        links: { imdb: null, imdb_id: null },
        ...movie,
        showtimes,
      },
    ],
  };
}

const badge = (s: { audio_lang?: string | null; subtitle_lang?: string | null }) =>
  viewingLangLabel(viewingLang(s));

describe("viewingLang", () => {
  it("shows English for English audio regardless of subs", () => {
    expect(badge({ audio_lang: "en", subtitle_lang: "es" })).toBe("English");
    expect(badge({ audio_lang: "en" })).toBe("English");
  });
  it("shows the subtitle language for foreign audio", () => {
    expect(badge({ audio_lang: "other", subtitle_lang: "en" })).toBe("English subs");
    expect(badge({ audio_lang: "other", subtitle_lang: "es" })).toBe("Spanish subs");
    expect(badge({ subtitle_lang: "ca" })).toBe("Catalan subs");
  });
  it("returns null when unknown", () => {
    expect(badge({})).toBeNull();
    expect(badge({ audio_lang: null, subtitle_lang: null })).toBeNull();
    expect(badge({ audio_lang: "other" })).toBeNull();
  });
  it("has a compact form for the showtime pill", () => {
    expect(viewingLangLabel(viewingLang({ audio_lang: "en" }), "short")).toBe("EN");
    expect(viewingLangLabel(viewingLang({ subtitle_lang: "es" }), "short")).toBe("ES subs");
    expect(viewingLangLabel(null, "short")).toBeNull();
  });
});

describe("premiumFormatLabel", () => {
  it("maps a known slug to its display label", () => {
    expect(premiumFormatLabel("imax")).toBe("IMAX");
  });
  it("renders nothing for absent or unknown slugs", () => {
    expect(premiumFormatLabel(null)).toBeNull();
    expect(premiumFormatLabel(undefined)).toBeNull();
    expect(premiumFormatLabel("")).toBeNull();
    // Rollback safety: a slug written by a newer deploy gets no chip, not "DOLBY".
    expect(premiumFormatLabel("dolby")).toBeNull();
  });
});

describe("buildCinemaRows premium format", () => {
  // No fake timers: transformResponse and buildCinemaRows both take `now`.
  it("emits the resolved formatBadge label per time", () => {
    const listings = sampleListings([
      { theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" },
      { theater_id: "verdi", date: "2026-03-29", time: "21:40", language: "vo", premium_format: "imax" },
    ]);

    const now = new Date("2026-03-29T10:00:00");
    const [movie] = transformResponse(listings, now);
    const [row] = buildCinemaRows(movie, null, null, now);
    const times = row.dayGroups.flatMap((g) => g.times);
    expect(times.map((t) => t.formatBadge)).toEqual([null, "IMAX"]);
  });
});

describe("day horizon", () => {
  const now = new Date("2026-03-29T10:00:00");

  it("defaults to a week of chips", () => {
    expect(generateDays(now)).toHaveLength(7);
    expect(generateDays(now)[0].label).toBe("Today");
  });

  it("stretches to reach a day the providers published beyond the week", () => {
    // Providers occasionally publish an 8th day. Without a chip for it those
    // showtimes render under "All" but no filter can isolate them.
    const listings = sampleListings([
      { theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" },
      { theater_id: "verdi", date: "2026-04-05", time: "18:00", language: "vo" },
    ]);
    const movies = transformResponse(listings, now);

    expect(dayHorizon(movies)).toBe(8);
    const days = generateDays(now, dayHorizon(movies));
    expect(days).toHaveLength(8);
    expect(days.map((d) => d.offset)).toContain(7);
  });

  it("never shrinks below a week for a short run", () => {
    const listings = sampleListings([
      { theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" },
    ]);
    expect(dayHorizon(transformResponse(listings, now))).toBe(7);
  });
});

describe("buildCinemaGroups", () => {
  const now = new Date("2026-03-29T10:00:00");
  const twoDays = () =>
    transformResponse(
      sampleListings([
        { theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" },
        { theater_id: "verdi", date: "2026-03-30", time: "20:00", language: "vo" },
        { theater_id: "verdi", date: "2026-03-30", time: "22:15", language: "vo" },
      ]),
      now,
    );

  it("keeps each day's times apart when no day filter is applied", () => {
    // Regression: times used to be deduped across the whole week into one
    // undated row, so a week's union read as one evening's schedule.
    const [group] = buildCinemaGroups(twoDays(), null, null);
    const [film] = group.films;

    expect(film.days.map((d) => d.offset)).toEqual([0, 1]);
    expect(film.days[0].times).toEqual(["18:00"]);
    expect(film.days[1].times).toEqual(["20:00", "22:15"]);
  });

  it("collapses to one unlabelled group when a day is already selected", () => {
    const [group] = buildCinemaGroups(twoDays(), 1, null);
    const [film] = group.films;

    expect(film.days).toHaveLength(1);
    expect(film.days[0].offset).toBe(-1);
    expect(film.days[0].times).toEqual(["20:00", "22:15"]);
  });
});

describe("buildDaySections", () => {
  const now = new Date("2026-03-29T10:00:00");
  const listings = (): Listings => ({
    ...sampleListings([
      { theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" },
      { theater_id: "malda", date: "2026-03-29", time: "19:30", language: "vo" },
      { theater_id: "verdi", date: "2026-03-30", time: "20:00", language: "vo" },
    ]),
    theaters: [
      ...sampleListings([]).theaters,
      {
        id: "malda",
        name: "Cinema Maldà",
        address: "Carrer del Pi, 5",
        neighborhood: "Gotic",
        website_url: "",
        maps_url: "",
        lat: null,
        lng: null,
      },
    ],
  });

  it("groups day-first, with every cinema for that day inside it", () => {
    const [movie] = transformResponse(listings(), now);
    const sections = buildDaySections(movie, null, null, now);

    expect(sections.map((s) => s.offset)).toEqual([0, 1]);
    expect(sections[0].label).toBe("Today");
    expect(sections[0].cinemas.map((c) => c.theater.name)).toEqual([
      "Cinema Maldà",
      "Cinemes Verdi",
    ]);
    expect(sections[1].cinemas.map((c) => c.theater.name)).toEqual(["Cinemes Verdi"]);
  });

  it("returns the single selected day, labelled from the real offset", () => {
    const [movie] = transformResponse(listings(), now);
    const sections = buildDaySections(movie, 1, null, now);

    expect(sections).toHaveLength(1);
    expect(sections[0].offset).toBe(1);
    expect(sections[0].label).toBe(generateDays(now)[1].label);
    expect(sections[0].cinemas[0].times.map((t) => t.t)).toEqual(["20:00"]);
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
    const listings = sampleListings(
      [{ theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" }],
      { poster_url: "https://image.tmdb.org/t/p/w342/project-hail-mary.jpg" },
    );

    const [movie] = transformResponse(listings);
    expect(movie.poster_url).toBe("https://image.tmdb.org/t/p/w342/project-hail-mary.jpg");
  });

  it("preserves director and cast on transformed movies", () => {
    vi.setSystemTime(new Date("2026-03-29T10:00:00"));
    const listings = sampleListings(
      [{ theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo", audio_lang: "other", subtitle_lang: "es" }],
      { title: "Dune", director: "Denis Villeneuve", cast: ["Timothée Chalamet", "Zendaya"], original_lang: "en" },
    );

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
    const listings = sampleListings(
      [{ theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" }],
      { title: "Dead Film" },
    );

    const result = transformResponse(listings);
    expect(result).toHaveLength(0);
  });

  it("keeps only future showtimes when a film has a mix of past and future", () => {
    vi.setSystemTime(new Date("2026-03-29T16:00:00"));
    const listings = sampleListings(
      [
        { theater_id: "verdi", date: "2026-03-29", time: "12:00", language: "vo" }, // past
        { theater_id: "verdi", date: "2026-03-29", time: "20:00", language: "vo" }, // future
      ],
      { title: "Mixed Times" },
    );

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

describe("parseSortMode", () => {
  it("returns 'next' only for the exact parameter value", () => {
    expect(parseSortMode("next")).toBe("next");
  });
  it("falls back to 'rating' for anything else", () => {
    expect(parseSortMode(null)).toBe("rating");
    expect(parseSortMode("")).toBe("rating");
    expect(parseSortMode("rating")).toBe("rating");
    expect(parseSortMode("NEXT")).toBe("rating");
    expect(parseSortMode("next ")).toBe("rating");
    expect(parseSortMode("%%%")).toBe("rating");
  });
});

describe("sortMovies", () => {
  const now = new Date("2026-03-29T10:00:00");

  /** Several films sharing the sampleListings movie/theater shape. */
  const films = (specs: Array<{ title: string; showtimes: Showtime[] }>) =>
    transformResponse(
      {
        ...sampleListings([]),
        movies: specs.map((s, i) => ({ ...sampleListings([]).movies[0], id: `movie-${i}`, ...s })),
      },
      now,
    );

  const scoped = () =>
    films([
      {
        title: "Matinee And Late",
        showtimes: [
          { theater_id: "verdi", date: "2026-03-29", time: "12:00", language: "vo" },
          { theater_id: "verdi", date: "2026-03-31", time: "22:00", language: "vo" },
        ],
      },
      {
        title: "Only Day Two",
        showtimes: [{ theater_id: "verdi", date: "2026-03-31", time: "09:00", language: "vo" }],
      },
      {
        title: "Day Zero Only",
        showtimes: [{ theater_id: "verdi", date: "2026-03-29", time: "20:00", language: "vo" }],
      },
    ]);

  it("returns the input untouched in rating mode", () => {
    const movies = scoped();
    // The rating branch returns `movies` itself, not a copy.
    expect(sortMovies(movies, "rating", null)).toBe(movies);
  });

  it("orders by the earliest remaining showtime across all days", () => {
    const movies = films([
      {
        title: "Early Tomorrow",
        showtimes: [{ theater_id: "verdi", date: "2026-03-30", time: "09:00", language: "vo" }],
      },
      {
        title: "Late Tonight",
        showtimes: [{ theater_id: "verdi", date: "2026-03-29", time: "21:00", language: "vo" }],
      },
    ]);

    expect(sortMovies(movies, "next", null).map((m) => m.title)).toEqual([
      "Late Tonight",
      "Early Tomorrow",
    ]);
  });

  it("scopes 'next' to the selected day, not the film's earliest matinée", () => {
    expect(sortMovies(scoped(), "next", null).map((m) => m.title)).toEqual([
      "Matinee And Late",
      "Day Zero Only",
      "Only Day Two",
    ]);
    expect(sortMovies(scoped(), "next", 2).map((m) => m.title)).toEqual([
      "Only Day Two",
      "Matinee And Late",
      "Day Zero Only",
    ]);
  });

  it("sinks films with nothing left in scope to the end", () => {
    const order = sortMovies(scoped(), "next", 2).map((m) => m.title);
    expect(order[order.length - 1]).toBe("Day Zero Only");
  });

  it("breaks ties alphabetically by title", () => {
    const sameTime = films([
      {
        title: "Zulu",
        showtimes: [{ theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" }],
      },
      {
        title: "Amelie",
        showtimes: [{ theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" }],
      },
    ]);

    expect(sortMovies([...sameTime].reverse(), "next", null).map((m) => m.title)).toEqual([
      "Amelie",
      "Zulu",
    ]);
  });

  it("does not mutate the input array", () => {
    const movies = scoped();
    const before = movies.map((m) => m.title);
    sortMovies(movies, "next", 2);
    expect(movies.map((m) => m.title)).toEqual(before);
  });
});

describe("movieMatchesQuery", () => {
  const now = new Date("2026-03-29T10:00:00");

  // Accented neighborhood: the query side is normalized by the caller, the data
  // side by movieMatchesQuery, so "gracia" must reach "Gràcia".
  const movie = () => {
    const base = sampleListings(
      [{ theater_id: "verdi", date: "2026-03-29", time: "18:00", language: "vo" }],
      {
        title: "Amélie",
        genres: ["Romance", "Comedy"],
        director: "Jean-Pierre Jeunet",
        cast: ["Audrey Tautou", "Mathieu Kassovitz"],
      },
    );
    return transformResponse(
      { ...base, theaters: [{ ...base.theaters[0], neighborhood: "Gràcia" }] },
      now,
    )[0];
  };

  // ListPage normalizes the query before calling; mirror that here.
  const matches = (q: string) => movieMatchesQuery(movie(), normalizeForSearch(q));

  it("matches on title, genre, director and cast", () => {
    expect(matches("amelie")).toBe(true);
    expect(matches("comedy")).toBe(true);
    expect(matches("jeunet")).toBe(true);
    expect(matches("tautou")).toBe(true);
  });

  it("matches on the cinema name reached through the showtimes", () => {
    expect(matches("verdi")).toBe(true);
    expect(matches("Cinemes")).toBe(true);
  });

  it("matches on the cinema neighborhood", () => {
    expect(matches("gracia")).toBe(true);
  });

  it("is accent- and case-insensitive", () => {
    expect(matches("AMÉLIE")).toBe(true);
    expect(matches("Gràcia")).toBe(true);
    expect(matches("VERDI")).toBe(true);
  });

  it("matches everything on an empty query", () => {
    expect(matches("")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(matches("godzilla")).toBe(false);
  });
});

