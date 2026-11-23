import type { Page } from "@playwright/test";

/**
 * Nothing scrolls sideways (brief): not the page, and not any element of its
 * own, so an `overflow-x: auto|scroll` box wider inside than out fails. No
 * element pokes past the viewport's edges either, so `overflow-x: hidden` on
 * the root or on a scroller can't hide a too-wide element.
 */
export async function checkNoOverflow(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const root = document.documentElement;
    const width = root.clientWidth;
    const found: string[] = [];
    if (root.scrollWidth > width)
      found.push(`the page is ${root.scrollWidth}px wide in ${width}px`);
    const offenders: Element[] = [];
    for (const el of [document.body, ...document.body.querySelectorAll("*")]) {
      if (
        /auto|scroll/.test(getComputedStyle(el).overflowX) &&
        el.scrollWidth > el.clientWidth + 1
      ) {
        const tag = el.outerHTML.slice(0, el.outerHTML.indexOf(">") + 1).slice(0, 80);
        found.push(`${tag} scrolls sideways: ${el.scrollWidth}px in ${el.clientWidth}px`);
      }
      const box = el.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      const left = box.left + scrollX;
      const right = box.right + scrollX;
      if (left >= -1 && right <= width + 1) continue;
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
