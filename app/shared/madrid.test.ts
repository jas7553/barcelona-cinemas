import { describe, expect, it } from "vitest";
import { addDays, cinemaDay, MADRID_TZ, madridIso, madridWallClock } from "./madrid.ts";

it("names a valid IANA zone", () => {
  expect(() => new Intl.DateTimeFormat("en", { timeZone: MADRID_TZ })).not.toThrow();
});

describe("madridIso", () => {
  it.each([
    ["2026-11-23", "21:00", "2026-11-23T21:00+01:00"],
    ["2026-07-01", "21:00", "2026-07-01T21:00+02:00"],
    ["2026-03-29", "01:59", "2026-03-29T01:59+01:00"],
    ["2026-03-29", "03:00", "2026-03-29T03:00+02:00"],
    ["2026-10-25", "02:30", "2026-10-25T02:30+02:00"],
    ["2026-10-25", "03:00", "2026-10-25T03:00+01:00"],
  ])("%s %s is %s", (date, time, iso) => {
    expect(madridIso(date, time)).toBe(iso);
    expect(madridWallClock(new Date(iso))).toEqual({ date, time });
  });

  it("throws for a time skipped when clocks go forward", () => {
    expect(() => madridIso("2026-03-29", "02:30")).toThrow(RangeError);
  });

  it("throws for an impossible date", () => {
    expect(() => madridIso("2026-02-30", "12:00")).toThrow(RangeError);
  });
});

it("addDays crosses months, years and DST changes", () => {
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
});

it("madridWallClock rolls over at Madrid midnight, not UTC", () => {
  expect(madridWallClock(new Date("2026-06-30T22:30:00Z")).date).toBe("2026-07-01");
  expect(madridWallClock(new Date("2026-06-30T21:30:00Z")).date).toBe("2026-06-30");
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
