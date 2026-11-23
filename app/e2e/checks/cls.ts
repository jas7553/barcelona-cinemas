import type { Page } from "@playwright/test";
import { scrollToMiddle, settle } from "./settle.ts";

/** docs/plan.md §7.2. */
const MAX_CLS = 0.02;

/**
 * Chromium only (WebKit reports no layout shifts), with bfcache off, so Back
 * is a real load. Sums every shift from navigation until the page has
 * settled, on load, reload and Back; each sum stays under MAX_CLS. The sum is at
 * least the CLS metric (its worst session window), so this is the stricter
 * reading. It ignores `hadRecentInput`: the flow gives no input, yet Chromium
 * flags early shifts after a Playwright navigation as following input.
 * Reload and Back leave from the middle of the page, where restoring the
 * scroll position can expose late shifts.
 */
export async function checkCls(page: Page, path: string, awayPath: string): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __e2eCls: number };
    w.__e2eCls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number }[]) {
        w.__e2eCls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const read = async () => {
    await settle(page);
    return page.evaluate(() => (window as unknown as { __e2eCls: number }).__e2eCls);
  };

  await page.goto(path);
  const scores: Record<string, number> = { load: await read() };
  await scrollToMiddle(page);
  await page.reload();
  scores["reload"] = await read();
  await scrollToMiddle(page);
  await page.goto(awayPath);
  await page.goBack();
  const kind = await page.evaluate(
    () => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).type,
  );
  if (kind !== "back_forward") {
    throw new Error(
      `CLS: Back has to load the page again, but its entry says "${kind}" (bfcache on?)`,
    );
  }
  scores["back"] = await read();

  const over = Object.entries(scores).filter(([, score]) => score >= MAX_CLS);
  if (over.length > 0) {
    const list = over.map(([when, score]) => `${when} ${score.toFixed(4)}`).join(", ");
    throw new Error(`CLS ≥ ${MAX_CLS} on ${path}: ${list}`);
  }
}
