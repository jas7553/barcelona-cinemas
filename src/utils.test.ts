import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dateLabel, fmtRuntime, relativeTime, isFuture } from "./utils";

describe("fmtRuntime", () => {
  it("formats minutes only", () => expect(fmtRuntime(45)).toBe("45m"));
  it("formats hours only", () => expect(fmtRuntime(120)).toBe("2h"));
  it("formats hours and minutes", () => expect(fmtRuntime(157)).toBe("2h 37m"));
});

describe("relativeTime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns 'just now' for under 1 minute", () => {
    vi.setSystemTime(new Date("2026-03-28T10:00:00Z"));
    expect(relativeTime("2026-03-28T09:59:45Z")).toBe("just now");
  });

  it("returns minutes ago", () => {
    vi.setSystemTime(new Date("2026-03-28T10:05:00Z"));
    expect(relativeTime("2026-03-28T10:00:00Z")).toBe("5 minutes ago");
  });

  it("uses singular for 1 minute", () => {
    vi.setSystemTime(new Date("2026-03-28T10:01:00Z"));
    expect(relativeTime("2026-03-28T10:00:00Z")).toBe("1 minute ago");
  });

  it("returns hours ago", () => {
    vi.setSystemTime(new Date("2026-03-28T13:00:00Z"));
    expect(relativeTime("2026-03-28T10:00:00Z")).toBe("3 hours ago");
  });

  it("returns days ago", () => {
    vi.setSystemTime(new Date("2026-03-30T10:00:00Z"));
    expect(relativeTime("2026-03-28T10:00:00Z")).toBe("2 days ago");
  });
});

describe("dateLabel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns 'Today' for today's date", () => {
    vi.setSystemTime(new Date("2026-03-28T10:00:00"));
    expect(dateLabel("2026-03-28")).toBe("Today");
  });

  it("returns 'Tomorrow' for tomorrow's date", () => {
    vi.setSystemTime(new Date("2026-03-28T10:00:00"));
    expect(dateLabel("2026-03-29")).toBe("Tomorrow");
  });

  it("returns formatted weekday for other dates", () => {
    vi.setSystemTime(new Date("2026-03-28T10:00:00"));
    const label = dateLabel("2026-03-30");
    expect(label).toMatch(/Mon/);
  });
});

describe("isFuture", () => {
  it("returns true for future showtime", () => {
    const now = new Date("2026-03-28T10:00:00");
    expect(isFuture({ date: "2026-03-28", time: "18:00" }, now)).toBe(true);
  });

  it("returns false for past showtime", () => {
    const now = new Date("2026-03-28T20:00:00");
    expect(isFuture({ date: "2026-03-28", time: "18:00" }, now)).toBe(false);
  });
});
