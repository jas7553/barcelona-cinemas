import { expect, it } from "vitest";
import { renderHome } from "./render.tsx";

it("renders the heading with the Madrid day", () => {
  expect(renderHome(new Date("2026-06-30T22:30:00Z"))).toBe(
    "<h1>Barcelona this week, from 2026-07-01</h1>",
  );
});
