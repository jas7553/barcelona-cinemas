import { describe, expect, it } from "vitest";
import { distanceKm, whereLabel } from "./distance";
import { formatDistance, formatRuntime, joinAnd, plural, shortName, smallPoster, subtitleLabel } from "./format";
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
    expect(subtitleLabel({ audio_lang: "other", subtitle_lang: "es" })).toBe("Spanish subs");
    expect(subtitleLabel({ audio_lang: "en", subtitle_lang: "es" })).toBeNull();
    expect(subtitleLabel({ audio_lang: null, subtitle_lang: "es" })).toBeNull();
    expect(subtitleLabel({ audio_lang: "other", subtitle_lang: null })).toBeNull();
  });

  it("asks TMDb for a small poster", () => {
    expect(smallPoster("https://image.tmdb.org/t/p/w342/abc.jpg")).toBe("https://image.tmdb.org/t/p/w154/abc.jpg");
  });
});

describe("distance", () => {
  const verdi = { lat: 41.404, lng: 2.1569, neighborhood: "Gràcia" };

  it("measures straight-line km from Home", () => {
    expect(distanceKm({ lat: 41.4021, lng: 2.1558 }, verdi)).toBeCloseTo(0.23, 2);
  });

  it("falls back to the neighbourhood without Home or coordinates", () => {
    const theater = { id: "v", name: "V", address: "", website_url: "", maps_url: "", ...verdi };
    expect(whereLabel(null, theater)).toBe("Gràcia");
    expect(whereLabel({ lat: 41.4, lng: 2.15 }, { ...theater, lat: null })).toBe("Gràcia");
    expect(whereLabel({ lat: 41.4021, lng: 2.1558 }, theater)).toBe("250 m");
  });
});

describe("ticket", () => {
  it("estimates Out ~ as start + runtime + 15, or + 110 when unknown, across midnight", () => {
    expect(outTime("22:20", 157)).toBe("01:12");
    expect(outTime("18:45", null)).toBe("20:50");
  });

  it("writes share text with the short weekday and day", () => {
    expect(shareText("Aftersun", "Verdi", { date: "2026-10-08", time: "21:30" })).toBe("Aftersun · Verdi · Thu 8, 21:30");
  });
});
