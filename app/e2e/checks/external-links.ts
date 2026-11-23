import type { Page } from "@playwright/test";
import { BOOKING } from "../markers.ts";

const ARROW = "↗";

/**
 * Every link to another origin ends in ↗, as text in the DOM (a CSS
 * `::after` arrow doesn't count), except a showtime's booking link, which
 * carries the BOOKING marker, wraps a `<time>` and has no arrow. mailto: and
 * tel: links are not checked.
 */
export async function checkExternalLinks(page: Page): Promise<void> {
  const problems = await page.evaluate(
    ([booking, arrow]) => {
      const found: string[] = [];
      for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        const url = new URL(a.href);
        if (url.protocol !== "http:" && url.protocol !== "https:") continue;
        const text = a.textContent.trim();
        const html = a.outerHTML.slice(0, 100);
        const external = url.origin !== location.origin;
        if (!a.hasAttribute(booking)) {
          if (external && !text.endsWith(arrow)) found.push(`no ${arrow}: ${html}`);
          continue;
        }
        if (!external) found.push(`${booking} on a same-origin link: ${html}`);
        else if (!a.querySelector("time"))
          found.push(`${booking} on a link without a <time>: ${html}`);
        else if (text.endsWith(arrow)) found.push(`a booking link with ${arrow}: ${html}`);
      }
      return found;
    },
    [BOOKING, ARROW] as const,
  );
  if (problems.length > 0) {
    throw new Error(`external links:\n  ${problems.slice(0, 15).join("\n  ")}`);
  }
}
