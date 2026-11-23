import { describe, expect, it } from "vitest";
import { addDays, MADRID_TZ, madridIso, madridWallClock } from "./madrid.ts";

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
