import { expect, type Locator, type Page } from "@playwright/test";
import { PREF_KEYS } from "../src/domain/prefs";

export const HOME = { lat: 41.4021, lng: 2.1558 };

/** Console errors and uncaught exceptions, including CSP violations. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    // The 404 document itself arrives with a 404 status, which Chromium logs.
    if (msg.type() === "error" && !msg.text().includes("status of 404")) errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** Stores prefs before the page's own scripts run. */
export async function seedPrefs(page: Page, prefs: { home?: object; seen?: string[]; fav?: string[] }) {
  const entries: [string, string][] = [];
  if (prefs.home) entries.push([PREF_KEYS.home, JSON.stringify(prefs.home)]);
  if (prefs.seen) entries.push([PREF_KEYS.seen, JSON.stringify(prefs.seen)]);
  if (prefs.fav) entries.push([PREF_KEYS.favourites, JSON.stringify(prefs.fav)]);
  await page.addInitScript((e) => {
    for (const [k, v] of e) localStorage.setItem(k, v);
  }, entries);
}

/** Paint well before hydration, as a phone on 4G would. */
export async function slowBundle(page: Page) {
  await page.route(/\/assets\/.*\.js$/, async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
}

/** Starts summing layout shifts on the next load; read them with `readCls`. */
export async function watchCls(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { cls: number };
    w.cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) w.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

export const readCls = (page: Page) => page.evaluate(() => (window as unknown as { cls: number }).cls);

/** The tappable span through the middle of a control is at least 44px; it needn't be centred on it. */
export async function expectHit44(el: Locator, name?: string) {
  const height = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const x = r.left + Math.min(r.width / 2, 20);
    const hits = (y: number) => node.contains(document.elementFromPoint(x, y));
    let top = r.top + r.height / 2;
    let bottom = top;
    while (hits(top - 1)) top--;
    while (hits(bottom + 1)) bottom++;
    return bottom - top + 1;
  });
  expect(height, `${name ?? (await el.getAttribute("class"))} hit area is under 44px tall`).toBeGreaterThanOrEqual(44);
}
