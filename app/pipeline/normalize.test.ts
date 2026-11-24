import { describe, expect, it } from "vitest";
import {
  normalizeAudioLang,
  normalizePremiumFormat,
  normalizeSubtitleLang,
  scrapedFilm,
  showingStart,
} from "./normalize.ts";

describe("normalizeAudioLang", () => {
  it.each([
    ["English", "en"],
    ["Anglès", "en"],
    ["Inglés", "en"],
    ["Japonès", "other"],
    ["Español", "other"],
    ["", undefined],
    ["   ", undefined],
  ])("%j → %j", (raw, expected) => {
    expect(normalizeAudioLang(raw)).toBe(expected);
  });
});

describe("normalizeSubtitleLang", () => {
  it.each([
    ["English", "en"],
    ["Anglès", "en"],
    ["Español", "es"],
    ["Castellano", "es"],
    ["Espanyol", "es"],
    ["Català", "ca"],
    ["Catalan", "ca"],
    ["Català i castellà", "ca"],
    ["Francès", undefined],
    ["", undefined],
  ])("%j → %j", (raw, expected) => {
    expect(normalizeSubtitleLang(raw)).toBe(expected);
  });
});

describe("normalizePremiumFormat", () => {
  it.each([
    ["Imax", "imax"],
    ["IMAX", "imax"],
    ["IMAX 3D", "imax"],
    ["Sala IMAX", "imax"],
    ["The IMAX Experience", "imax"],
    ["Digital", undefined],
    ["DIGITAL", undefined],
    ["ScreenX", undefined],
    ["", undefined],
  ])("%j → %j", (raw, expected) => {
    expect(normalizePremiumFormat(raw)).toBe(expected);
  });
});

describe("showingStart", () => {
  it("uses Madrid's offset for the date", () => {
    expect(showingStart("2026-07-14", "21:30")).toBe("2026-07-14T21:30+02:00");
    expect(showingStart("2026-11-23", "21:00")).toBe("2026-11-23T21:00+01:00");
  });

  it.each([
    ["2026-03-29", "02:30"],
    ["2026-02-30", "20:00"],
    ["2026-7-14", "20:00"],
    ["2026-07-14", "9:45"],
    ["", ""],
  ])("rejects %s %s", (date, time) => {
    expect(showingStart(date, time)).toBeUndefined();
  });
});

describe("scrapedFilm", () => {
  it("leaves out an unknown imdb_id rather than storing undefined", () => {
    expect(scrapedFilm("Alien", undefined, [])).toStrictEqual({ title: "Alien", showings: [] });
    expect(scrapedFilm("Alien", "tt0078748", [])).toStrictEqual({
      title: "Alien",
      imdb_id: "tt0078748",
      showings: [],
    });
  });
});
