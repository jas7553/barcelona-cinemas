import { describe, expect, it } from "vitest";
import type { Showing } from "../pageData";
import { byCinema } from "./film";
import type { Ranking } from "./schedule";

const at = (theater_id: string, date: string, time: string): Showing => ({ theater_id, date, time });
const rank = (favourites: string[], km: Record<string, number>): Ranking => ({
  favourite: (id) => favourites.includes(id),
  km: (id) => km[id] ?? null,
});

describe("byCinema", () => {
  const shows = [
    at("far", "2026-10-05", "18:00"),
    at("near", "2026-10-05", "21:00"),
    at("near", "2026-10-05", "17:00"),
    at("nowhere", "2026-10-05", "12:00"),
    at("fav", "2026-10-05", "22:00"),
    at("near", "2026-10-06", "10:00"),
  ];

  it("groups the day's showings by cinema, in time order within each", () => {
    const groups = byCinema(shows, "2026-10-05", rank([], {}));
    expect(groups.find((g) => g.theaterId === "near")!.showings.map((s) => s.time)).toEqual(["17:00", "21:00"]);
  });

  it("orders favourites first, then the nearest, then unknown distances by first time", () => {
    const groups = byCinema(shows, "2026-10-05", rank(["fav"], { far: 3, near: 0.2, fav: 5 }));
    expect(groups.map((g) => g.theaterId)).toEqual(["fav", "near", "far", "nowhere"]);
  });

  it("falls back to the earliest first with no Home", () => {
    expect(byCinema(shows, "2026-10-05", rank([], {})).map((g) => g.theaterId)).toEqual([
      "nowhere",
      "near",
      "far",
      "fav",
    ]);
  });
});
