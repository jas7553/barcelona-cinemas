import { expect, it } from "vitest";
import { madridDay } from "./madrid-date.ts";

it("rolls over at Madrid midnight, not UTC", () => {
  expect(madridDay(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
  expect(madridDay(new Date("2026-06-30T21:30:00Z"))).toBe("2026-06-30");
});
