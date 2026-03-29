import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatDayLabel, formatRuntime, relativeTime } from "./utils";

describe("formatRuntime", () => {
  it("formats minutes only", () => expect(formatRuntime(45)).toBe("45m"));
  it("formats hours only", () => expect(formatRuntime(120)).toBe("2h"));
  it("formats hours and minutes", () => expect(formatRuntime(157)).toBe("2h 37m"));
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

describe("formatDayLabel", () => {
  it("returns 'Today' for offset 0", () => {
    expect(formatDayLabel(0, new Date("2026-03-28"))).toBe("Today");
  });

  it("returns 'Tomorrow' for offset 1", () => {
    expect(formatDayLabel(1, new Date("2026-03-29"))).toBe("Tomorrow");
  });

  it("returns formatted weekday for offset >= 2", () => {
    const label = formatDayLabel(2, new Date("2026-03-30"));
    expect(label).toMatch(/Mon/);
  });
});
