import { describe, expect, it } from "vitest";
import {
  addDays,
  formatDateLong,
  formatDayFull,
  formatInstant,
  formatWeekday,
  formatWeekdayLong,
  isStale,
  madridDateKey,
  madridTime,
} from "./time";

describe("Madrid wall clock", () => {
  it("buckets an instant into its Madrid day, not UTC's", () => {
    // 23:30 UTC on 3 Oct is 01:30 on 4 Oct in Madrid (CEST, +02:00).
    const instant = new Date("2026-10-03T23:30:00Z");
    expect(madridDateKey(instant)).toBe("2026-10-04");
    expect(madridTime(instant)).toBe("01:30");
  });
});

describe("date keys", () => {
  it("adds days across month and DST boundaries", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-04", -4)).toBe("2026-09-30");
  });

  it("formats weekdays and long dates", () => {
    expect(formatWeekday("2026-10-02")).toBe("Fri");
    expect(formatWeekdayLong("2026-10-04")).toBe("Sunday");
    expect(formatDateLong("2026-10-02")).toBe("Fri 2 Oct");
    expect(formatDayFull("2026-10-24")).toBe("Saturday 24 October");
  });
});

describe("formatInstant", () => {
  it("formats an instant as Madrid date and 24-hour time", () => {
    expect(formatInstant("2026-10-14T15:00:00Z")).toBe("Wed 14 Oct, 17:00");
  });

  it("puts a late-UTC instant on the next Madrid day", () => {
    expect(formatInstant("2026-01-14T23:30:00Z")).toBe("Thu 15 Jan, 00:30");
  });
});

describe("isStale", () => {
  const generated_at = "2026-10-04T08:00:00Z";

  it("goes stale once the listings are more than a day old", () => {
    expect(isStale(generated_at, new Date(generated_at))).toBe(false);
    expect(isStale(generated_at, new Date("2026-10-05T07:59:00Z"))).toBe(false);
    expect(isStale(generated_at, new Date("2026-10-05T08:01:00Z"))).toBe(true);
  });
});
