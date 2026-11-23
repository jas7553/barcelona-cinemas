import type { Page } from "@playwright/test";

/**
 * The page doesn't scroll sideways, and no element pokes past the viewport's
 * edges, so `overflow-x: hidden` on the root can't hide a too-wide element.
 * Only content inside its own horizontal scroller may be wider (WCAG 1.4.10).
 */
export async function checkNoOverflow(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const root = document.documentElement;
    const width = root.clientWidth;
    const found: string[] = [];
    if (root.scrollWidth > width)
      found.push(`the page is ${root.scrollWidth}px wide in ${width}px`);
    const scrolls = (el: Element) => /auto|scroll/.test(getComputedStyle(el).overflowX);
    const offenders: Element[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      const left = box.left + scrollX;
      const right = box.right + scrollX;
      if (left >= -1 && right <= width + 1) continue;
      let ancestor = el.parentElement;
      while (ancestor && ancestor !== document.body && !scrolls(ancestor)) {
        ancestor = ancestor.parentElement;
      }
      if (ancestor !== document.body) continue;
      if (offenders.some((o) => o.contains(el))) continue;
      offenders.push(el);
      found.push(`${el.outerHTML.slice(0, 80)} spans ${Math.round(left)}–${Math.round(right)}px`);
    }
    return found;
  });
  if (problems.length > 0) {
    throw new Error(`horizontal overflow:\n  ${problems.slice(0, 10).join("\n  ")}`);
  }
}
