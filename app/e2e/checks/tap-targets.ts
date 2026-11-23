import type { Page } from "@playwright/test";

/** Apple's HIG minimum, which the brief adopts for every target. */
const MIN = 44;

/**
 * Every focusable, rendered element measures at least 44×44 CSS px; a form
 * control may count its label's box instead of its own.
 *
 * One exemption, WCAG 2.5.8's "inline" exception: a link inside a sentence,
 * whose height the line of text sets. It applies only to an `<a>` laid out
 * `display: inline` within a `<p>` that has text of its own outside links, so a
 * lone link, a link in a list item or a showtime never qualifies.
 */
export async function checkTapTargets(page: Page): Promise<void> {
  const small = await page.evaluate((min) => {
    const FOCUSABLE = [
      "a[href]",
      "area[href]",
      "button",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "summary",
      "iframe",
      "[tabindex]:not([tabindex='-1'])",
      "[contenteditable]:not([contenteditable=false])",
    ].join(",");
    const inSentence = (el: Element) => {
      if (el.localName !== "a" || getComputedStyle(el).display !== "inline") return false;
      const p = el.closest("p");
      if (!p) return false;
      const text = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let n = text.nextNode(); n; n = text.nextNode()) {
        if (!n.parentElement?.closest("a") && /\p{L}/u.test(n.textContent ?? "")) return true;
      }
      return false;
    };
    const big = (el: Element) => {
      const box = el.getBoundingClientRect();
      return box.width >= min - 0.01 && box.height >= min - 0.01;
    };
    const found: string[] = [];
    for (const el of document.querySelectorAll(FOCUSABLE)) {
      if (el.matches(":disabled") || el.closest("[inert]")) continue;
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      if (inSentence(el)) continue;
      const labels = [...document.querySelectorAll("label")].filter((l) => l.control === el);
      if ([el, ...labels].some(big)) continue;
      // A skip link, say, takes its size only when focused.
      if (el instanceof HTMLElement) el.focus({ preventScroll: true });
      const focused = big(el);
      if (el instanceof HTMLElement) el.blur();
      if (focused) continue;
      const box = el.getBoundingClientRect();
      found.push(
        `${el.outerHTML.slice(0, 80)} is ${box.width.toFixed(1)}×${box.height.toFixed(1)}`,
      );
    }
    return found;
  }, MIN);
  if (small.length > 0) {
    throw new Error(`targets under ${MIN}×${MIN} px:\n  ${small.slice(0, 15).join("\n  ")}`);
  }
}
