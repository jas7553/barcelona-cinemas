// Smoke tests for the old film page, which stays until its rewrite lands.
// Servers + date-shifted fixture data are handled by playwright.config.ts.
//
//   npm run e2e                  # all
//   npx playwright test --ui     # interactive

import { test, expect } from "@playwright/test";
import { premiumFormatFilmId } from "./fixture";

// Collected across the run; asserted empty at the end.
let consoleErrors: string[] = [];

// Cross-document View Transitions reject their internal promise when a
// transition is skipped (e.g. rapid navigation). The browser owns that promise
// — app code can't catch it — and it's harmless, so ignore it.
const isBenign = (msg: string) => /Transition was skipped|AbortError/.test(msg);

test.beforeEach(({ page }) => {
  consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !isBenign(m.text())) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => {
    if (!isBenign(String(e))) consoleErrors.push(String(e));
  });
});

// Deep link straight to a film page: SSG content paints with the real title and
// data embedded — no list visit, no fetch.
test("film deep link renders standalone", async ({ page }) => {
  await page.goto(`/film/${premiumFormatFilmId()}`);
  await expect(page.locator(".detail-film-title")).toBeVisible();
  await expect(page.locator(".detail-showtimes")).toBeVisible();
  expect(consoleErrors, consoleErrors.join(" | ")).toHaveLength(0);
});

// The one test exercising the whole premium-format chain: the fixture is a
// cache-shape file, so the injected value flows validation → transform →
// listings.json → SSG render → DOM.
test("premium format chip renders on the film page", async ({ page }) => {
  await page.goto(`/film/${premiumFormatFilmId()}`);
  await expect(page.locator(".showtime__tag--format").first()).toHaveText("IMAX");
  expect(consoleErrors, consoleErrors.join(" | ")).toHaveLength(0);
});

// Structure the film page exposes to assistive tech: a heading outline to
// navigate by rotor, day chips that are not dead ends, and showtime labels that
// distinguish one day from another.
test("film page exposes a11y structure", async ({ page }) => {
  await page.goto(`/film/${premiumFormatFilmId()}`);

  await expect(page.locator(".detail-film-title")).toBeVisible();
  expect(await page.locator("h1, h2, h3, h4, h5, h6").count()).toBeGreaterThanOrEqual(3);
  await expect(page.locator("footer")).toHaveCount(1);

  await test.step("a disabled day chip does not change the showtime list", async () => {
    const dead = page.locator(".day-chip[disabled]").first();
    if (await dead.count()) {
      const before = await page.locator(".showtime__main").count();
      await dead.click({ force: true });
      await expect(page.locator(".showtime__main")).toHaveCount(before);
    }
  });

  await test.step("showtimes on different days carry different aria-labels", async () => {
    const labels = await page
      .locator(".cinema-row")
      .first()
      .locator(".showtime__main")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
    expect(new Set(labels).size).toBe(labels.length);
  });

  expect(consoleErrors, consoleErrors.join(" | ")).toHaveLength(0);
});
