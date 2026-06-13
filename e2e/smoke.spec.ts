// End-to-end smoke test driving the core flows on a mobile viewport. Servers,
// fixture cache, and teardown are handled by playwright.config.ts.
//
//   npm run e2e                  # all
//   npx playwright test --ui     # interactive

import { test, expect, type Page } from "@playwright/test";
import { FIXTURE_TAGLINE } from "./fixture";

// Collected across the run; asserted empty before the deliberate API-down section.
let consoleErrors: string[] = [];

test.beforeEach(({ page }) => {
  consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
});

// One stateful journey: filter → detail → back (scroll restore) → search →
// cinema view → venue dialog → deep link → offline cached paint.
test("core mobile journey", async ({ page }) => {
  await test.step("list renders film cards", async () => {
    await page.goto("/");
    await expect(page.locator(".film-card").first()).toBeVisible();
    expect(await page.locator(".film-card").count()).toBeGreaterThan(0);
  });

  await test.step("day filter reflects in URL", async () => {
    await page.locator(".day-chip").nth(2).click();
    await expect(page).toHaveURL(/day=1/);
  });

  await test.step("open a card, keep day param", async () => {
    await page.locator(".film-card").first().click();
    await expect(page.locator(".detail-film-title")).toBeVisible();
    await expect(page).toHaveURL(/day=1/);
    await expect(page.locator(".detail-screen .day-chip--active")).toHaveCount(1);
    await expect(page.locator(".tagline")).toHaveText(FIXTURE_TAGLINE);
  });

  await test.step("back restores filters", async () => {
    await page.locator(".detail-back-btn").click();
    await expect(page.locator(".film-card").first()).toBeVisible();
    await expect(page).toHaveURL(/day=1/);
  });

  await test.step("search survives a detail round-trip", async () => {
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

  await test.step("no console errors so far", () => {
    expect(consoleErrors, consoleErrors.join(" | ")).toHaveLength(0);
  });

  await stalePaintWithApiDown(page);
});

// MainList unmounts when a detail opens, so it persists its scroll offset and
// restores it on the way back (regressed by 97bfb9a, fixed by the module-scoped
// savedScrollY in MainList).
test("back restores list scroll position", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".film-card").first()).toBeVisible();
  await page.locator(".day-chip").nth(2).click();
  await expect(page).toHaveURL(/day=1/);

  await page.evaluate(() => window.scrollTo(0, 800));
  // The scroll listener persists the offset on the (async) scroll event; wait
  // for that before navigating away, as a real drag would have flushed it.
  await page.waitForFunction(() => sessionStorage.getItem("btw-list-scroll") !== null);
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

  await page.locator(".detail-back-btn").click();
  await expect(page.locator(".film-card").first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { timeout: 3000 })
    .toBeCloseTo(scrollBefore, -2); // within ~50px
});

// Stale-while-revalidate: with the API dead, a repeat visit must still paint
// from the localStorage cache (the aborted fetch logs expected errors, so this
// runs after the no-console-errors assertion).
async function stalePaintWithApiDown(page: Page) {
  await test.step("listings cached locally", async () => {
    expect(await page.evaluate(() => localStorage.getItem("btw-listings"))).not.toBeNull();
  });
  await test.step("cached paint with API down", async () => {
    await page.route("**/api/listings", (route) => route.abort());
    await page.goto("/");
    await expect(page.locator(".film-card").first()).toBeVisible({ timeout: 5000 });
    expect(await page.locator(".film-card").count()).toBeGreaterThan(0);
  });
}
