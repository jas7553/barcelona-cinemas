import type { Page } from "@playwright/test";

/**
 * Times of day are 24-hour `HH:MM` inside `<time>`:
 * - a `<time>` whose `datetime` has a time (`…T21:30`, `21:30`) shows exactly
 *   that `HH:MM` and nothing else; a date-only `<time>` ("Friday 28") is free;
 * - outside `<time>`, no text looks like a clock time (`9:30`, `21:30`,
 *   `21h30`) and nothing reads as 12-hour (`9 pm`, `9:30 a.m.`).
 */
export async function checkTimes(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
    const DATETIME_TIME = /(?:^|T)(\d{2}:\d{2})/;
    const CLOCK = /\b\d{1,2}(?::|h)\d{2}\b/i;
    const TWELVE_HOUR = /\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\b\.?/i;
    const found: string[] = [];

    for (const time of document.querySelectorAll("time")) {
      const text = time.textContent.trim();
      const wanted = DATETIME_TIME.exec(time.getAttribute("datetime") ?? "")?.[1];
      if (wanted === undefined) {
        if (CLOCK.test(text) || TWELVE_HOUR.test(text)) {
          found.push(`a clock time in a <time> without a datetime time: ${time.outerHTML}`);
        }
      } else if (!HHMM.test(text)) {
        found.push(`not HH:MM: ${time.outerHTML}`);
      } else if (text !== wanted) {
        found.push(`shows ${text} but datetime says ${wanted}: ${time.outerHTML}`);
      }
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest("time, script, style, noscript, template")) continue;
      const text = node.textContent ?? "";
      const match = TWELVE_HOUR.exec(text) ?? CLOCK.exec(text);
      if (match)
        found.push(`a time outside <time>: "${match[0]}" in ${parent.outerHTML.slice(0, 80)}`);
    }
    return found;
  });
  if (problems.length > 0) {
    throw new Error(`times:\n  ${problems.slice(0, 15).join("\n  ")}`);
  }
}
