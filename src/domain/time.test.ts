import { describe, expect, it } from "vitest";
import {
  addDays,
  formatDataAge,
  formatDateLong,
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
  });
});

describe("formatDataAge", () => {
  const at = (iso: string) => new Date(iso);
  const generated = "2026-10-04T08:00:00Z";

  it("rounds down to the largest whole unit", () => {
    expect(formatDataAge(generated, at("2026-10-04T08:00:30Z"))).toBe("Updated just now");
    expect(formatDataAge(generated, at("2026-10-04T08:59:00Z"))).toBe("Updated 59 min ago");
    expect(formatDataAge(generated, at("2026-10-04T10:30:00Z"))).toBe("Updated 2 h ago");
    expect(formatDataAge(generated, at("2026-10-05T09:00:00Z"))).toBe("Updated 1 day ago");
    expect(formatDataAge(generated, at("2026-10-06T08:00:00Z"))).toBe("Updated 2 days ago");
  });

  it("never reports a negative age when the clock is behind the data", () => {
    expect(formatDataAge(generated, at("2026-10-04T07:00:00Z"))).toBe("Updated just now");
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
