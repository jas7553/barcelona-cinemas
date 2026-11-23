import type { Page } from "@playwright/test";
import { BOOKING, EXTERNAL_ICON, PLACE, SHOWING } from "../markers.ts";

const ARROW = "↗";

/**
 * Every link to another origin ends in ↗: either as text in the DOM (a CSS
 * `::after` arrow doesn't count) or as an EXTERNAL_ICON last child with a
 * name. The exceptions carry no arrow: a showtime's booking link, which
 * carries the BOOKING marker and wraps a `<time>`, and a showing's cinema link
 * to Google Maps, which carries the PLACE marker. mailto: and tel: links are
 * not checked.
 */
export async function checkExternalLinks(page: Page): Promise<void> {
  const problems = await page.evaluate(
    ([booking, place, showing, icon, arrow]) => {
      const found: string[] = [];

      for (const el of document.querySelectorAll(`[${icon}]`)) {
        const html = el.outerHTML.slice(0, 100);
        const named =
          el.getAttribute("role") === "img" &&
          ((el.getAttribute("aria-label") ?? "").trim() !== "" ||
            (el.querySelector(":scope > title")?.textContent.trim() ?? "") !== "");
        if (!named || el.closest("[aria-hidden=true]")) {
          found.push(`${icon} without role="img" and a name: ${html}`);
        }
        const a = el.parentElement?.closest("a[href]");
        if (!a) {
          found.push(`${icon} outside a link: ${html}`);
          continue;
        }
        const after = document.createRange();
        after.setStartAfter(el);
        after.setEnd(a, a.childNodes.length);
        if (el.parentElement !== a || after.toString().trim() !== "") {
          found.push(`${icon} isn't the link's last child: ${a.outerHTML.slice(0, 160)}`);
        }
      }

      const hasArrow = (a: HTMLAnchorElement) =>
        a.textContent.trim().endsWith(arrow) || a.lastElementChild?.hasAttribute(icon) === true;

      for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        const url = new URL(a.href);
        if (url.protocol !== "http:" && url.protocol !== "https:") continue;
        const html = a.outerHTML.slice(0, 100);
        const external = url.origin !== location.origin;
        if (a.hasAttribute(place)) {
          const maps = url.hostname === "www.google.com" && url.pathname.startsWith("/maps");
          if (!maps) found.push(`${place} on a link that isn't Google Maps: ${html}`);
          else if (!a.closest(`[${showing}]`)) found.push(`${place} outside a showing: ${html}`);
          else if (hasArrow(a)) found.push(`a place link with ${arrow}: ${html}`);
          continue;
        }
        if (!a.hasAttribute(booking)) {
          if (external && !hasArrow(a)) found.push(`no ${arrow}: ${html}`);
          continue;
        }
        if (!external) found.push(`${booking} on a same-origin link: ${html}`);
        else if (!a.querySelector("time"))
          found.push(`${booking} on a link without a <time>: ${html}`);
        else if (hasArrow(a)) found.push(`a booking link with ${arrow}: ${html}`);
      }
      return found;
    },
    [BOOKING, PLACE, SHOWING, EXTERNAL_ICON, ARROW] as const,
  );
  if (problems.length > 0) {
    throw new Error(`external links:\n  ${problems.slice(0, 15).join("\n  ")}`);
  }
}
