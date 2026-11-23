import type { Page } from "@playwright/test";

/**
 * Chromium only, with bfcache on (Playwright's WebKit never restores from it).
 * Load, go away, come Back: the page fires `pageshow` with `persisted`, and its
 * navigation entry has no `notRestoredReasons`. On failure, the reasons
 * Chromium gives are in the message.
 */
export async function checkBfcache(page: Page, path: string, awayPath: string): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __e2ePersisted?: boolean };
    addEventListener("pageshow", (e) => {
      w.__e2ePersisted = e.persisted;
    });
    addEventListener("pagehide", () => {
      delete w.__e2ePersisted;
    });
  });
  await page.goto(path);
  await page.waitForLoadState("load");
  await page.goto(awayPath);
  await page.goBack({ waitUntil: "commit" });
  await page.waitForFunction(() => "__e2ePersisted" in window);

  const state = await page.evaluate(() => ({
    persisted: (window as unknown as { __e2ePersisted: boolean }).__e2ePersisted,
    reasons: JSON.stringify(
      (performance.getEntriesByType("navigation")[0] as { notRestoredReasons?: unknown })
        .notRestoredReasons ?? null,
    ),
  }));
  if (!state.persisted || state.reasons !== "null") {
    throw new Error(
      `bfcache: Back to ${path} wasn't restored (persisted ${state.persisted}); notRestoredReasons ${state.reasons}`,
    );
  }
}
