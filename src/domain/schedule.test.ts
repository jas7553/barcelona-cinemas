import { describe, expect, it } from "vitest";
import type { CalendarDay, ListFilm, Showing } from "../pageData";
import type { Theater } from "../types";
import {
  byStart,
  daySections,
  dayStatus,
  filmRows,
  hasStarted,
  notOutFrom,
  pageDays,
  ranking,
  rowSummary,
  weekSections,
  weekSummary,
  type Clock,
} from "./schedule";

const clock: Clock = { today: "2026-10-04", time: "17:30" };

function theater(id: string, name: string, lat: number | null, lng: number | null): Theater {
  return { id, name, address: "", neighborhood: `${name} barri`, website_url: "", maps_url: "", lat, lng };
}

const VERDI = theater("verdi", "Cines Verdi", 41.404, 2.1569);
const PARK = theater("verdi-park", "Cines Verdi Park", 41.4035, 2.157);
const GLORIES = theater("glories", "Cinesa Glòries", 41.4053, 2.1925);
const NOWHERE = theater("nowhere", "Cinema Nowhere", null, null);
const THEATERS = [VERDI, PARK, GLORIES, NOWHERE];
const BY_ID = new Map(THEATERS.map((t) => [t.id, t]));
const HOME = { lat: 41.4021, lng: 2.1558 };

const at = (theater_id: string, date: string, time: string, extra: Partial<Showing> = {}): Showing => ({
  theater_id,
  date,
  time,
  ...extra,
});

function film(id: string, showtimes: Showing[]): ListFilm {
  return { id, title: id, poster_url: null, rating: null, genres: [], runtime_minutes: 100, showtimes };
}

const day = (date: string, cinemas: number, last = "22:00"): CalendarDay => ({ date, cinemas, last });

describe("hasStarted", () => {
  it("counts a showing at the current minute as not started yet", () => {
    expect(hasStarted({ date: "2026-10-04", time: "17:29" }, clock)).toBe(true);
    expect(hasStarted({ date: "2026-10-04", time: "17:30" }, clock)).toBe(false);
    expect(hasStarted({ date: "2026-10-03", time: "23:00" }, clock)).toBe(true);
    expect(hasStarted({ date: "2026-10-05", time: "09:00" }, clock)).toBe(false);
  });
});

describe("notOutFrom (requirements 11.1)", () => {
  it("is the first day with fewer than half of today's cinemas, so one-off previews don't count", () => {
    // Live data on 2026-10-04: 15 cinemas today, Fri 9 had 5, Sat 10 had 7.
    const calendar = [
      day("2026-10-04", 15),
      day("2026-10-05", 15),
      day("2026-10-08", 14),
      day("2026-10-09", 5),
      day("2026-10-10", 7),
    ];
    expect(notOutFrom(calendar, "2026-10-04")).toBe("2026-10-06");
    calendar.splice(2, 0, day("2026-10-06", 15), day("2026-10-07", 14));
    expect(notOutFrom(calendar, "2026-10-04")).toBe("2026-10-09");
  });

  it("counts exactly half as out", () => {
    expect(notOutFrom([day("2026-10-04", 10), day("2026-10-05", 5)], "2026-10-04")).toBe("2026-10-06");
  });

  it("is null when the whole horizon is published", () => {
    const calendar = Array.from({ length: 8 }, (_, i) => day(`2026-10-${String(4 + i).padStart(2, "0")}`, 10));
    expect(notOutFrom(calendar, "2026-10-04")).toBeNull();
  });

  it("falls back to the day after the last published date when nothing is on today", () => {
    expect(notOutFrom([day("2026-10-05", 3), day("2026-10-07", 1)], "2026-10-04")).toBe("2026-10-08");
    expect(notOutFrom([], "2026-10-04")).toBeNull();
  });
});

describe("dayStatus", () => {
  const calendar = [day("2026-10-04", 10, "17:00"), day("2026-10-05", 10), day("2026-10-06", 2)];

  it("is nothing-left once today's last showing has started", () => {
    expect(dayStatus("2026-10-04", calendar, clock, "2026-10-06")).toBe("nothing-left");
    expect(dayStatus("2026-10-04", calendar, { ...clock, time: "16:00" }, "2026-10-06")).toBe("on");
  });

  it("marks not-out days even when a few showings are out", () => {
    expect(dayStatus("2026-10-06", calendar, clock, "2026-10-06")).toBe("not-out");
    expect(dayStatus("2026-10-07", calendar, clock, "2026-10-06")).toBe("not-out");
  });

  it("is nothing-left for a published day with no showings, and for past days", () => {
    expect(dayStatus("2026-10-05", [day("2026-10-04", 3)], clock, null)).toBe("nothing-left");
    expect(dayStatus("2026-10-03", calendar, clock, null)).toBe("nothing-left");
  });
});

describe("pageDays", () => {
  it("is on while the page has a showing left, else the day's own status", () => {
    const calendar = [day("2026-10-04", 10, "21:00"), day("2026-10-05", 10), day("2026-10-06", 2)];
    const shows = [{ theater_id: "a", date: "2026-10-04", time: "16:00" }, { theater_id: "a", date: "2026-10-06", time: "20:00" }];
    const status = pageDays(shows, calendar, clock).map((d) => d.status);
    expect(status.slice(0, 4)).toEqual(["nothing-left", "nothing-left", "on", "not-out"]);
  });
});

describe("ordering", () => {
  it("breaks ties between equal times by favourite, then distance, with unknown distance last", () => {
    const rank = ranking(THEATERS, HOME, new Set(["glories"]));
    const shows = [at("nowhere", "2026-10-05", "18:00"), at("verdi", "2026-10-05", "18:00"), at("glories", "2026-10-05", "18:00")];
    expect([...shows].sort(byStart(rank)).map((s) => s.theater_id)).toEqual(["glories", "verdi", "nowhere"]);
  });

  it("keeps films with showings left in range, dropping started ones", () => {
    const rank = ranking(THEATERS, null, new Set());
    const films = [
      film("gone", [at("verdi", "2026-10-04", "12:00")]),
      film("later", [at("verdi", "2026-10-04", "12:00"), at("verdi", "2026-10-04", "20:00")]),
      film("outside", [at("verdi", "2026-10-12", "20:00")]),
    ];
    const rows = filmRows(films, ["2026-10-04", "2026-10-05"], clock, rank);
    expect(rows.map((r) => [r.film.id, r.showings.length])).toEqual([["later", 1]]);
  });

  const many = (id: string, n: number, rating: number | null = null) => ({
    ...film(id, Array.from({ length: n }, (_, i) => at("verdi", "2026-10-05", `1${i}:00`))),
    rating,
  });
  const week = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];

  it("splits This week into a few showings (soonest first), all week (highest rated first) and seen", () => {
    const rank = ranking(THEATERS, null, new Set());
    const films = [
      film("rare-late", [at("verdi", "2026-10-07", "20:00")]),
      film("rare-soon", [at("verdi", "2026-10-05", "20:00"), at("verdi", "2026-10-06", "20:00")]),
      many("big", 6, 7.8),
      many("bigger", 9, 6.5),
      many("seen", 5),
      many("seen-bigger", 8),
    ];
    const rows = filmRows(films, week, clock, rank);
    const sections = weekSections(rows, new Set(["seen", "seen-bigger"]));
    expect(sections.few.map((r) => r.film.id)).toEqual(["rare-soon", "rare-late"]);
    expect(sections.all.map((r) => r.film.id)).toEqual(["big", "bigger"]);
    expect(sections.seen.map((r) => r.film.id)).toEqual(["seen-bigger", "seen"]);
  });

  it("puts unrated films last in all week and breaks rating ties on title", () => {
    const rank = ranking(THEATERS, null, new Set());
    const films = [many("unrated", 9), many("b", 4, 7), many("a", 5, 7), many("low", 6, 0.5)];
    const rows = filmRows(films, week, clock, rank);
    expect(weekSections(rows, new Set()).all.map((r) => r.film.id)).toEqual(["a", "b", "low", "unrated"]);
  });
});

describe("rowSummary", () => {
  const summary = (showtimes: Showing[], home: typeof HOME | null = HOME) => {
    const rank = ranking(THEATERS, home, new Set());
    const [row] = filmRows([film("f", showtimes)], ["2026-10-04", "2026-10-05", "2026-10-06"], clock, rank);
    return rowSummary(row, BY_ID, rank, clock.today);
  };

  it("spells out a single showing with its day, time and cinema, and its distance", () => {
    expect(summary([at("glories", "2026-10-06", "18:30")])).toEqual({
      line: "Tue 6, 18:30 · Glòries",
      distance: "3.1 km from home",
    });
    expect(summary([at("glories", "2026-10-04", "18:30")], null)).toEqual({ line: "Today, 18:30 · Glòries", distance: "" });
  });

  it("gives one cinema's distance without calling it the nearest", () => {
    expect(summary([at("verdi", "2026-10-05", "18:00"), at("verdi", "2026-10-06", "20:00")])).toEqual({
      line: "2 showings · Verdi",
      distance: "250 m from home",
    });
  });

  it("names up to two cinemas, nearest first, and the nearest one's distance", () => {
    expect(summary([at("glories", "2026-10-05", "18:00"), at("verdi", "2026-10-05", "20:00")])).toEqual({
      line: "2 showings · Verdi, Glòries",
      distance: "Nearest: Verdi, 250 m",
    });
  });

  it("counts cinemas past two and flags IMAX", () => {
    const shows = [
      at("verdi", "2026-10-05", "18:00"),
      at("verdi-park", "2026-10-05", "18:00"),
      at("glories", "2026-10-05", "19:00", { premium_format: "imax" }),
    ];
    expect(summary(shows)).toEqual({ line: "3 showings · 3 cinemas · IMAX", distance: "Nearest: Verdi Park, 200 m" });
    expect(summary(shows, null)).toEqual({ line: "3 showings · 3 cinemas · IMAX", distance: "" });
  });

  // The line is painted before Home loads, so Home mustn't change how it wraps.
  it("keeps the line's text the same length with and without Home", () => {
    const shows = [at("glories", "2026-10-05", "18:00"), at("verdi", "2026-10-05", "20:00", { premium_format: "imax" })];
    expect(summary(shows).line).toHaveLength(summary(shows, null).line.length);
  });

  it("leaves the distance out when the nearest cinema has no coordinates", () => {
    expect(summary([at("nowhere", "2026-10-05", "18:00")])).toEqual({ line: "Mon 5, 18:00 · Nowhere", distance: "" });
  });
});

describe("film order", () => {
  it("breaks ties between films on title, so Home and favourites never reorder rows", () => {
    const rank = ranking(THEATERS, HOME, new Set(["verdi"]));
    const films = [film("b", [at("verdi", "2026-10-05", "18:00")]), film("a", [at("glories", "2026-10-05", "18:00")])];
    const rows = filmRows(films, ["2026-10-05"], clock, rank);
    expect(daySections(rows, new Set()).films.map((r) => r.film.id)).toEqual(["a", "b"]);
    expect(weekSections(rows, new Set()).few.map((r) => r.film.id)).toEqual(["a", "b"]);
  });
});

describe("weekSummary", () => {
  const shows = [
    at("verdi", "2026-10-04", "16:00"),
    at("glories", "2026-10-04", "19:00"),
    at("verdi", "2026-10-06", "20:00"),
    at("verdi-park", "2026-10-06", "18:00"),
    at("verdi", "2026-10-06", "21:00"),
    at("nowhere", "2026-10-09", "20:00"),
    at("verdi", "2026-10-11", "20:00"),
    at("gone", "2026-10-07", "20:00"),
  ];

  it("lists each day in the horizon with its cinemas, alphabetically, omitting empty days", () => {
    expect(weekSummary(shows, BY_ID, clock)).toEqual([
      { date: "2026-10-04", cinemas: ["Glòries", "Verdi"] },
      { date: "2026-10-06", cinemas: ["Verdi", "Verdi Park"] },
      { date: "2026-10-07", cinemas: ["gone"] },
      { date: "2026-10-09", cinemas: ["Nowhere"] },
    ]);
  });

  it("is the same before and after a showing starts, so nothing moves under the reader", () => {
    const early = weekSummary(shows, BY_ID, { today: "2026-10-04", time: "09:00" });
    expect(weekSummary(shows, BY_ID, { today: "2026-10-04", time: "23:00" })).toEqual(early);
    expect(early[0]).toEqual({ date: "2026-10-04", cinemas: ["Glòries", "Verdi"] });
  });

  it("follows the clock: past midnight the day rolls off and a new one comes in", () => {
    const next: Clock = { today: "2026-10-05", time: "00:10" };
    const days = weekSummary(shows, BY_ID, next).map((d) => d.date);
    expect(days).toEqual(["2026-10-06", "2026-10-07", "2026-10-09", "2026-10-11"]);
  });

  it("is empty when nothing is left", () => {
    expect(weekSummary(shows, BY_ID, { today: "2026-10-12", time: "00:00" })).toEqual([]);
  });
});
