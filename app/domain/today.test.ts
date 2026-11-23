import { expect, it } from "vitest";
import { today } from "./today.ts";

it("is still yesterday at 05:59 Madrid and turns over at 06:00", () => {
  expect(today(new Date("2026-11-24T05:59:00+01:00"))).toBe("2026-11-23");
  expect(today(new Date("2026-11-24T06:00:00+01:00"))).toBe("2026-11-24");
});
