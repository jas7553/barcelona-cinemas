// End-to-end smoke test driving the core flows on a mobile viewport. The app is
// now an MPA: list (/) and detail (/film/<id>) are separate static documents, so
// navigation is real (back/forward via the browser, scroll restored natively).
// Servers + date-shifted fixture data are handled by playwright.config.ts.
//
//   npm run e2e                  # all
//   npx playwright test --ui     # interactive

import { test, expect } from "@playwright/test";
import { FIXTURE_TAGLINE, premiumFormatFilmId } from "./fixture";

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

// One stateful journey: filter → detail (real nav) → back → search → cinema view
// → venue dialog → deep link.
test("core mobile journey", async ({ page }) => {
  await test.step("list renders film cards", async () => {
    await page.goto("/");
    await expect(page.locator(".film-card").first()).toBeVisible();
    expect(await page.locator(".film-card").count()).toBeGreaterThan(0);
  });

  await test.step("stylesheet is linked and actually applied", async () => {
    // An unstyled page still has every element "visible" (default block flow),
    // so element presence can't prove CSS loaded. Assert computed style took
    // effect (cards are not the UA default). The unit test in render-core.test.mjs
    // guards that the stylesheet href survives SSG manifest resolution.
    const styled = await page.evaluate(() => {
      const card = document.querySelector(".film-card");
      if (!card) return false;
      // A bare <a>/<div> defaults to display:inline/block with no padding;
      // our CSS gives film cards a non-default box. Any of these proves styling.
      const s = getComputedStyle(card);
      return s.display === "flex" || s.display === "grid" || parseFloat(s.paddingTop) > 0;
    });
    expect(styled, "film-card has no applied CSS — stylesheet not loaded").toBe(true);
  });

  await test.step("day filter reflects in URL", async () => {
    await page.locator(".day-chip").nth(2).click();
    await expect(page).toHaveURL(/day=1/);
  });

  await test.step("open a card — real nav, day param carried in the URL", async () => {
    await page.locator(".film-card").first().click();
    await expect(page).toHaveURL(/\/film\/.+day=1/);
    await expect(page.locator(".detail-film-title")).toBeVisible();
    await expect(page.locator(".detail-screen .day-chip--active")).toHaveCount(1);
    await expect(page.locator(".tagline")).toHaveText(FIXTURE_TAGLINE);
  });

  await test.step("back returns to the list with its filter", async () => {
    await page.goBack();
    await expect(page.locator(".film-card").first()).toBeVisible();
    await expect(page).toHaveURL(/day=1/);
  });

  await test.step("search survives a detail round-trip (bfcache)", async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('button[aria-label="Search films"]').click();
    await page.locator(".search-input").fill("a");
    await expect(page).toHaveURL(/q=a/);
    await page.locator(".film-card").first().click();
    await expect(page.locator(".detail-film-title")).toBeVisible();
    await page.goBack();
    await expect(page.locator(".search-input")).toHaveValue("a");
    await page.locator(".search-cancel").click();
    await expect(page).not.toHaveURL(/q=/);
  });

  await test.step("cinema view renders groups", async () => {
    await page.locator(".view-tab", { hasText: "By Cinema" }).click();
    await expect(page.locator(".cinema-group").first()).toBeVisible();
    expect(await page.locator(".cinema-group").count()).toBeGreaterThan(0);
    await expect(page.locator(".near-btn")).toHaveCount(1);
  });

  await test.step("cinema header opens venue sheet", async () => {
    await page.locator(".cinema-group__header").first().click();
    await expect(page.locator(".cinema-dialog[open]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".cinema-dialog[open]")).toHaveCount(0);
  });

  await test.step("venue dialog opens from detail", async () => {
    await page.locator(".cinema-group__film").first().click();
    await expect(page.locator(".detail-film-title")).toBeVisible();
    await page.locator(".cinema-row__header").first().click();
    await expect(page.locator(".cinema-dialog[open]")).toHaveCount(1);
  });

  await test.step("deep-linked day chip scrolls into view", async () => {
    await page.goto("/?day=6");
    await expect(page.locator(".day-chip--active")).toBeVisible();
    const chipVisible = await page.evaluate(() => {
      const el = document.querySelector(".day-chip--active");
      const row = el?.parentElement;
      if (!el || !row) return false;
      const er = el.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      return er.left >= rr.left && er.right <= rr.right + 1;
    });
    expect(chipVisible).toBe(true);
  });

  await test.step("no console errors", () => {
    expect(consoleErrors, consoleErrors.join(" | ")).toHaveLength(0);
  });
});

// Deep link straight to a film page: SSG content paints with the real title and
// data embedded — no list visit, no fetch.
test("film deep link renders standalone", async ({ page }) => {
  await page.goto("/");
  const href = await page.locator(".film-card").first().getAttribute("href");
  expect(href).toMatch(/^\/film\//);

  await page.goto(href!);
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

// Back navigation restores list scroll natively (the whole point of the MPA
// refactor — no manual save/restore). Cross-document back uses bfcache.
test("back restores list scroll position", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".film-card").first()).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 800));
  const scrollBefore = await page.evaluate(() => window.scrollY); // may clamp short
  expect(scrollBefore).toBeGreaterThan(0);

  // Click a card already in view — Playwright auto-scrolls offscreen targets,
  // which would corrupt the scroll-restore assertion.
  const visibleIdx = await page.evaluate(() =>
    [...document.querySelectorAll(".film-card")].findIndex((c) => {
      const r = c.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    }),
  );
  await page.locator(".film-card").nth(visibleIdx).click();
  await expect(page.locator(".detail-film-title")).toBeVisible();

  await page.goBack();
  await expect(page.locator(".film-card").first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 3000 })
    .toBeCloseTo(scrollBefore, -2); // within ~50px
});
