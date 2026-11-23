import { expect, it } from "vitest";
import { renderHome } from "./render.tsx";

it("renders the heading with the site's today", () => {
  expect(renderHome(new Date("2026-07-01T06:30:00+02:00"))).toBe(
    "<h1>Barcelona This Week, from 2026-07-01</h1>",
  );
});
