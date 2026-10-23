import { describe, expect, it } from "vitest";
import { distanceKm } from "./distance";
import { formatDistance, formatRuntime, joinAnd, plural, shortName, showingName, smallPoster, smallPosterSrcset, subtitleLabel } from "./format";
import { outTime, shareText } from "./ticket";

describe("format", () => {
  it("prefers the published short name, else strips the chain prefix", () => {
    expect(shortName({ name: "Cines Verdi Park", short_name: "Verdi Park" })).toBe("Verdi Park");
    expect(shortName({ name: "Cinesa Diagonal Mar" })).toBe("Diagonal Mar");
    expect(shortName({ name: "Mooby Balmes" })).toBe("Balmes");
    expect(shortName({ name: "Filmoteca de Catalunya" })).toBe("Filmoteca de Catalunya");
  });

  it("rounds distances to 50 m under 1 km, then tenths of a km", () => {
    expect(formatDistance(0.01)).toBe("50 m");
    expect(formatDistance(0.26)).toBe("250 m");
    expect(formatDistance(0.99)).toBe("1.0 km");
    expect(formatDistance(3.14)).toBe("3.1 km");
  });

  it("formats runtimes, counts and lists", () => {
    expect(formatRuntime(125)).toBe("2h 05m");
    expect(formatRuntime(45)).toBe("45m");
    expect(plural(1, "showing")).toBe("1 showing");
    expect(plural(3, "film")).toBe("3 films");
    expect(joinAnd(["Sat"])).toBe("Sat");
    expect(joinAnd(["Fri", "Sat"])).toBe("Fri and Sat");
    expect(joinAnd(["Thu", "Fri", "Sat"])).toBe("Thu, Fri and Sat");
  });

  it("tags subtitles only for non-English audio with known subtitles", () => {
    expect(subtitleLabel({ audio_lang: "other", subtitle_lang: "es" })).toBe("Spanish subtitles");
    expect(subtitleLabel({ audio_lang: "en", subtitle_lang: "es" })).toBeNull();
    expect(subtitleLabel({ audio_lang: null, subtitle_lang: "es" })).toBeNull();
    expect(subtitleLabel({ audio_lang: "other", subtitle_lang: null })).toBeNull();
  });

  it("asks TMDb for a small poster", () => {
    expect(smallPoster("https://image.tmdb.org/t/p/w342/abc.jpg")).toBe("https://image.tmdb.org/t/p/w154/abc.jpg");
    expect(smallPosterSrcset("https://image.tmdb.org/t/p/w342/abc.jpg")).toBe(
      "https://image.tmdb.org/t/p/w92/abc.jpg 92w, https://image.tmdb.org/t/p/w154/abc.jpg 154w",
    );
  });
});

describe("distance", () => {
  const verdi = { lat: 41.404, lng: 2.1569 };

  it("measures straight-line km from Home", () => {
    expect(distanceKm({ lat: 41.4021, lng: 2.1558 }, verdi)).toBeCloseTo(0.23, 2);
  });
});

describe("ticket", () => {
  it("estimates Out ~ as start + runtime + 15, or + 110 when unknown, across midnight", () => {
    expect(outTime("22:20", 157)).toBe("01:12");
    expect(outTime("18:45", null)).toBe("20:50");
  });

  it("names a showing chip by time, cinema, day and whether it books", () => {
    const base = { time: "21:00", date: "2026-10-23", cinema: "Verdi", siteOnly: false };
    expect(showingName(base)).toBe("21:00, Verdi, Friday 23 October, book tickets");
    expect(showingName({ ...base, siteOnly: true })).toBe("21:00, Verdi, Friday 23 October, no booking page, cinema site");
    expect(showingName({ ...base, title: "Aftersun", tags: ["IMAX", null, "English subtitles"] })).toBe(
      "Aftersun, 21:00, IMAX, English subtitles, Verdi, Friday 23 October, book tickets",
    );
  });

  it("writes share text with the short weekday and day", () => {
    expect(shareText("Aftersun", "Verdi", { date: "2026-10-08", time: "21:30" })).toBe("Aftersun · Verdi · Thu 8, 21:30");
  });
});
