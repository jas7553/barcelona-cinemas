import { expect, it } from "vitest";
import { cinemaDay, madridDay } from "./madrid-date.ts";

it("rolls over at Madrid midnight, not UTC", () => {
  expect(madridDay(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
  expect(madridDay(new Date("2026-06-30T21:30:00Z"))).toBe("2026-06-30");
});

it.each([
  ["2026-11-23T05:59:00+01:00", "2026-11-22"],
  ["2026-11-23T06:00:00+01:00", "2026-11-23"],
  ["2026-11-24T00:30:00+01:00", "2026-11-23"],
  ["2026-11-23T23:59:00+01:00", "2026-11-23"],
  ["2026-10-25T05:30:00+01:00", "2026-10-24"],
  ["2026-03-29T05:59:00+02:00", "2026-03-28"],
  ["2026-03-29T06:00:00+02:00", "2026-03-29"],
])("the cinema day of %s is %s", (iso, day) => {
  expect(cinemaDay(new Date(iso))).toBe(day);
});
