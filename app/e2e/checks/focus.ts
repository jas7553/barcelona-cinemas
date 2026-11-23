import type { Page } from "@playwright/test";

interface Stop {
  /** Position in document order, or -1 when focus is on the body or nowhere. */
  readonly order: number;
  readonly html: string;
  readonly ring: boolean;
}

/**
 * A keyboard-only walk (brief: a visible outline on every interactive element;
 * WCAG 2.4.3 and 2.4.7):
 * - no element has a positive `tabindex`;
 * - Tab reaches every visible, enabled focusable element, in DOM order;
 * - each, focused by Tab, shows an outline at least 2px wide in a color that
 *   isn't transparent. Only an outline counts, since it survives forced
 *   colors.
 */
export async function checkFocus(page: Page): Promise<void> {
  const { positive, focusable } = await page.evaluate(() => {
    const all = [...document.querySelectorAll("*")];
    const html = (el: Element) => el.outerHTML.slice(0, 80);
    const candidates = document.querySelectorAll<HTMLElement>(
      "a[href], area[href], button, input:not([type=hidden]), select, textarea, summary, iframe, [contenteditable], [tabindex]",
    );
    return {
      positive: [...document.querySelectorAll<HTMLElement>("[tabindex]")]
        .filter((el) => el.tabIndex > 0)
        .map(html),
      focusable: [...candidates]
        .filter(
          (el) =>
            el.tabIndex >= 0 &&
            !el.matches(":disabled") &&
            !el.closest("[inert]") &&
            el.checkVisibility({ visibilityProperty: true }),
        )
        .map((el) => ({ order: all.indexOf(el), html: html(el) })),
    };
  });

  // Safari's Tab skips links unless a setting is on; Option-Tab always reaches them.
  const webkit = page.context().browser()?.browserType().name() === "webkit";
  const tab = webkit ? "Alt+Tab" : "Tab";
  const stops: Stop[] = [];
  for (let i = 0; i <= focusable.length; i++) {
    await page.keyboard.press(tab);
    const stop = await page.evaluate((): Stop => {
      const el = document.activeElement;
      if (!el || el === document.body) return { order: -1, html: "", ring: false };
      const style = getComputedStyle(el);
      const transparent = /^transparent$|[,/]\s*0(?:\.0*)?\)$/.test(style.outlineColor);
      return {
        order: [...document.querySelectorAll("*")].indexOf(el),
        html: el.outerHTML.slice(0, 80),
        ring: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2 && !transparent,
      };
    });
    if (stop.order === -1 || stops.some((s) => s.order === stop.order)) break;
    stops.push(stop);
  }

  const problems = positive.map((html) => `a positive tabindex: ${html}`);
  for (const [i, stop] of stops.entries()) {
    const before = stops[i - 1];
    if (before && stop.order < before.order) {
      problems.push(`Tab went back up the page, from ${before.html} to ${stop.html}`);
    }
    if (!stop.ring) problems.push(`no visible outline on focus: ${stop.html}`);
  }
  const reached = new Set(stops.map((s) => s.order));
  for (const el of focusable) {
    if (!reached.has(el.order)) problems.push(`Tab never reached ${el.html}`);
  }
  if (problems.length > 0) {
    throw new Error(`keyboard focus:\n  ${problems.slice(0, 15).join("\n  ")}`);
  }
}
