import { expect, it } from "vitest";
import { MADRID_TZ } from "./madrid.ts";

it("names a valid IANA zone", () => {
  expect(() => new Intl.DateTimeFormat("en", { timeZone: MADRID_TZ })).not.toThrow();
});
