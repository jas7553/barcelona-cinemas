import type { Page } from "@playwright/test";
import { SETTLE_MS, scrollToMiddle, settle } from "./settle.ts";

/** Rounding slack, in CSS px. */
const SLACK = 1;

interface Place {
  scrollY: number;
  /** Which h1–h6, in document order, is the first one in view. */
  heading: number;
  top: number;
}

/**
 * For WebKit, which reports no layout shifts. From the middle of the page,
 * reload and then go away and Back. Each time, once the browser has restored
 * the scroll position, it matches where the page was left and the heading in
 * view sits where it did; SETTLE_MS later, neither has moved.
 */
export async function checkScrollRestore(
  page: Page,
  path: string,
  awayPath: string,
): Promise<void> {
  await page.goto(path);
  await settle(page);
  await scrollToMiddle(page);
  const left = await place(page);
  if (left.heading < 0) throw new Error(`scroll: no heading in view on ${path}`);

  const problems: string[] = [];
  for (const how of ["reload", "Back"] as const) {
    if (how === "reload") {
      await page.reload();
    } else {
      await page.goto(awayPath);
      await page.goBack();
    }
    await page.waitForLoadState("load");
    try {
      await page.waitForFunction(
        ({ y, slack }) => Math.abs(scrollY - y) <= slack,
        { y: left.scrollY, slack: SLACK },
        { timeout: SETTLE_MS },
      );
    } catch {
      // Compared below.
    }
    const restored = await place(page, left.heading);
    await page.waitForTimeout(SETTLE_MS);
    const later = await place(page, left.heading);
    for (const [when, now] of [
      ["on return", restored],
      [`${SETTLE_MS} ms later`, later],
    ] as const) {
      if (!(Math.abs(now.scrollY - left.scrollY) <= SLACK)) {
        problems.push(`${how}, ${when}: scrollY ${now.scrollY}, left at ${left.scrollY}`);
      }
      if (!(Math.abs(now.top - left.top) <= SLACK)) {
        problems.push(
          `${how}, ${when}: heading ${left.heading} at ${now.top}px, was ${left.top}px`,
        );
      }
    }
  }
  if (problems.length > 0) throw new Error(`scroll on ${path}:\n  ${problems.join("\n  ")}`);
}

/** The scroll position and a heading's place: `heading`'s, or else the first one in view. */
function place(page: Page, heading?: number): Promise<Place> {
  return page.evaluate((wanted) => {
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")];
    const index =
      wanted ??
      headings.findIndex((h) => {
        const box = h.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight;
      });
    const top = headings[index]?.getBoundingClientRect().top ?? Number.NaN;
    return { scrollY, heading: index, top: Math.round(top * 10) / 10 };
  }, heading);
}
