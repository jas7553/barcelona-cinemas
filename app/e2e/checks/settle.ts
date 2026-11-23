import type { Page } from "@playwright/test";

/** How long after load a page must hold still (docs/plan.md §7.2: "2 s later"). */
export const SETTLE_MS = 2000;

/** Waits for load, fonts and SETTLE_MS of quiet. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * Scrolls to the middle of the page, or stays at the top if it doesn't scroll,
 * then gives the browser time to record the position. Mobile WebKit scrolls in
 * its UI process, and a navigation straight after `scrollTo` saves the old
 * position in the history entry.
 */
export async function scrollToMiddle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    scrollTo(0, Math.round(Math.max(0, max) / 2));
  });
  await page.waitForTimeout(500);
}
