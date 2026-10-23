import { expect, type Locator, type Page } from "@playwright/test";
import { PREF_KEYS } from "../src/domain/prefs";

export const HOME = { lat: 41.4021, lng: 2.1558 };

/** Answers the street map's tile requests locally: a run may not reach the tile host. */
export function stubTiles(page: Page) {
  return page.route(/basemaps\.cartocdn\.com/, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"/>' }),
  );
}

/** Console errors and uncaught exceptions, including CSP violations. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  void stubTiles(page);
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

const BUNDLE = /\/assets\/.*\.js$/;

/** Paint well before hydration, as a phone on 4G would. */
export async function slowBundle(page: Page) {
  await page.route(BUNDLE, async (route) => {
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

const DISTANCE = /\d (k?m)\b/;

/** Resolves once the page shows a distance from Home, which only the bundle renders. */
export const distanceShown = (page: Page) => expect(page.locator("#root")).toContainText(DISTANCE);

/**
 * Each film row's and the cinema header's height, and its shown chips' widths
 * keyed by time and cinema: Home may reorder chips at the same time, nearest first.
 */
const boxes = (page: Page) =>
  page.$$eval("li.film, .cin-head", (els) =>
    els.map((e) => ({
      height: Math.round(e.getBoundingClientRect().height),
      chips: Object.fromEntries(
        [...e.querySelectorAll<HTMLElement>(".chip[aria-haspopup]")]
          .filter((c) => c.offsetWidth > 0)
          .map((c) => {
            const cinema = c.querySelector(".chip-w")!.textContent!.split(" · ")[0];
            return [`${c.querySelector(".chip-t")!.textContent} at ${cinema}`, c.offsetWidth];
          }),
      ),
    })),
  );

/** Same heights; chips are compared only where shown both times, not behind "N more times" in one. */
function expectSameBoxes(painted: Awaited<ReturnType<typeof boxes>>, settled: typeof painted) {
  expect(settled.map((b) => b.height)).toEqual(painted.map((b) => b.height));
  settled.forEach((b, i) => {
    for (const [chip, width] of Object.entries(b.chips)) {
      if (chip in painted[i].chips) expect(width, chip).toBe(painted[i].chips[chip]);
    }
  });
}

/**
 * Loads `url` with a saved Home, holding the bundle back until the painted
 * page has been measured, and checks that the distances it then fills in
 * move nothing. WebKit has no layout-shift entries, so it gets the box check alone.
 */
export async function expectSteadyAsHomeLoads(page: Page, url: string, width: number) {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await stubTiles(page);
  await page.route(BUNDLE, async (route) => {
    await held;
    await route.continue();
  });
  await page.setViewportSize({ width, height: 844 });
  await seedPrefs(page, { home: HOME });
  await watchCls(page);
  // Not "domcontentloaded": that waits for the (deferred) module bundle.
  await page.goto(url, { waitUntil: "commit" });
  await page.locator("#__APP_DATA__").waitFor({ state: "attached" });
  // Not document.fonts.ready, which WebKit holds until the load event.
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
  expect(await page.locator("#root").textContent(), "the bundle ran before the first look").not.toMatch(DISTANCE);
  const painted = await boxes(page);
  release();
  await distanceShown(page);
  expectSameBoxes(painted, await boxes(page));
  if (page.context().browser()?.browserType().name() === "chromium") {
    const cls = await readCls(page);
    console.log(`[cls] ${url} at ${width}px as Home loads: ${cls.toFixed(4)}`);
    expect(cls).toBeLessThan(0.001);
  }
}

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
