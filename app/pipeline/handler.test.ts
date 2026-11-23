import { expect, it } from "vitest";
import { handler } from "./handler.ts";

it("returns the Madrid zone", () => {
  expect(handler()).toEqual({ tz: "Europe/Madrid" });
});
