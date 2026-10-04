// This week, Day and the ticket sheet on the static build, under the production
// CSP. The data is the date-shifted fixture, so the first day is always today.

import { expect, test, type Page } from "@playwright/test";

const SEEN_KEY = "btw-seen";
const HOME_KEY = "btw-home";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const strip = (page: Page) => page.getByRole("navigation", { name: "Days" });
const rows = (page: Page) => page.locator("li.film");

/**
 * Tomorrow's Day page: published in the fixture, and nothing on it has started yet.
 * A direct load, so no view transition is still animating when the test clicks.
 */
async function gotoTomorrow(page: Page) {
  await page.goto("/");
  const href = (await strip(page).getByRole("link").nth(2).getAttribute("href"))!;
  await page.goto(href);
  await page.waitForLoadState("networkidle");
  await expect(rows(page).first()).toBeVisible();
}

test("This week renders the timetable and hydrates under the production CSP", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "This week" })).toBeVisible();
  await expect(strip(page).getByRole("link", { name: "Week" })).toHaveAttribute("aria-current", "page");
  expect(await rows(page).count()).toBeGreaterThan(0);

  const cell = page.locator("a.cell--on").first();
  await expect(cell).toHaveAccessibleName(/^(Today|\w+day): \d+ showings?$/);
  await expect(cell).toHaveAttribute("href", /^\/film\/[^/]+\/\d{4}-\d{2}-\d{2}\/$/);
  await expect(rows(page).first().locator(".film-sum")).toHaveText(/showing|\d{2}:\d{2}/);
  expect(errors).toEqual([]);
});

test("a day in the strip opens its Day page, with Week leading back", async ({ page }) => {
  await page.goto("/");
  await strip(page).getByRole("link").nth(2).click();
  await expect(page).toHaveURL(/\/day\/\d{4}-\d{2}-\d{2}\/$/);
  await expect(strip(page).locator('[aria-current="date"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "By start time" })).toBeVisible();
  await strip(page).getByRole("link", { name: "Week" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test.describe("ticket sheet", () => {
  test("a showtime opens its ticket in place, with booking or the cinema website as the primary action", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await gotoTomorrow(page);
    const url = page.url();
    const chip = rows(page).first().locator("button.chip").first();
    const time = (await chip.locator(".chip-t b").textContent())!;
    await chip.click();

    const ticket = page.getByRole("dialog");
    await expect(ticket).toBeVisible();
    await expect(ticket).toContainText(time);
    expect(page.url()).toBe(url);

    // The primary action is this showing's own booking link when it has one.
    const payload = await page.evaluate(() => JSON.parse(document.getElementById("__APP_DATA__")!.textContent!));
    const bookingUrls = new Set<string>(
      payload.films.flatMap((f: { showtimes: { booking_url?: string }[] }) =>
        f.showtimes.map((s) => s.booking_url).filter(Boolean),
      ),
    );
    const websites = new Set<string>(payload.theaters.map((t: { website_url: string }) => t.website_url));
    const primary = ticket.locator(".cta");
    const href = (await primary.getAttribute("href"))!;
    if ((await primary.textContent())!.startsWith("Book at")) expect(bookingUrls).toContain(href);
    else {
      expect(websites).toContain(href);
      await expect(ticket).toContainText("No direct booking link for this showing");
    }
    await expect(ticket.getByRole("link", { name: "Directions" })).toBeVisible();
    await expect(ticket.getByRole("button", { name: "Share" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Back closes the ticket and stays on the day", async ({ page }) => {
    await gotoTomorrow(page);
    const url = page.url();
    await rows(page).first().locator("button.chip").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(page.url()).toBe(url);
  });

  test("Share copies the showing when the system share sheet isn't there", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "clipboard permissions are Chromium-only in Playwright");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: undefined });
    });
    await gotoTomorrow(page);
    const title = (await rows(page).first().locator("h3").textContent())!;
    await rows(page).first().locator("button.chip").first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Share" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Copied" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · .+ · \\w{3} \\d{1,2}, \\d{2}:\\d{2} http.+/film/`));
  });
});

test("Back restores This week from bfcache with a film marked seen elsewhere", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Playwright's WebKit never restores from bfcache");
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    window.addEventListener("pageshow", (e) => {
      (window as unknown as { restored: boolean }).restored = e.persisted;
    });
  });
  await page.goto("/");
  await expect(page.locator("details.seen")).toHaveCount(0);
  const title = (await rows(page).first().locator("h3").textContent())!;
  await rows(page).first().locator("h3 a").click();
  await expect(page).toHaveURL(/\/film\//);

  // The film page is still the old one, but it writes the same key.
  await page.getByRole("button", { name: "Mark as seen" }).click();
  await page.goBack({ waitUntil: "commit" });
  await expect.poll(() => page.evaluate(() => (window as unknown as { restored?: boolean }).restored)).toBe(true);
  const seen = page.locator("details.seen");
  await expect(seen.locator("summary")).toHaveText("Seen (1)");
  // Collapsed, so out of the accessibility tree: match the markup.
  await expect(seen.locator("h3", { hasText: title })).toBeAttached();
  expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), SEEN_KEY))!)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("timetable cells and showtime chips have 44px hit areas", async ({ page }) => {
  await page.goto("/");
  for (const el of [page.locator("a.cell--on").first(), strip(page).getByRole("link").nth(1)]) {
    const ok = await el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      return [y - 21.5, y + 21.5].every((py) => node.contains(document.elementFromPoint(x, py)));
    });
    expect(ok, `${await el.getAttribute("class")} hit area is under 44px tall`).toBe(true);
  }
  await gotoTomorrow(page);
  const box = await rows(page).first().locator("button.chip").first().boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

for (const path of ["/", "day"]) {
  test(`${path === "/" ? "This week" : "Day"} with a saved Home and seen films doesn't shift when the bundle is slow`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "WebKit has no layout-shift entries");
    await page.goto("/");
    const url = path === "/" ? "/" : (await strip(page).getByRole("link").nth(2).getAttribute("href"))!;
    if (url !== "/") await page.goto(url);
    const seen = await page.$$eval("li[data-film]", (l) => l.slice(0, 3).map((e) => (e as HTMLElement).dataset.film));
    // Paint well before hydration, as a phone on 4G would.
    await page.route(/\/assets\/.*\.js$/, async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.addInitScript(
      ({ homeKey, seenKey, seen }) => {
        localStorage.setItem(homeKey, '{"lat":41.4021,"lng":2.1558}');
        localStorage.setItem(seenKey, JSON.stringify(seen));
        (window as unknown as { cls: number }).cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
            if (!entry.hadRecentInput) (window as unknown as { cls: number }).cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      },
      { homeKey: HOME_KEY, seenKey: SEEN_KEY, seen },
    );
    await page.goto(url);
    await expect(page.locator("details.seen summary")).toHaveText(`Seen (${seen.length})`);
    const cls = await page.evaluate(() => (window as unknown as { cls: number }).cls);
    console.log(`[cls] ${url} with Home + ${seen.length} seen: ${cls.toFixed(4)}`);
    expect(cls).toBeLessThan(0.02);
  });
}

test("Back returns to This week at the same scroll position", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, 800));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  // A title already in view and clear of the sticky strip, so clicking doesn't scroll.
  const index = await page.evaluate(() => {
    const top = document.querySelector(".strip")!.getBoundingClientRect().bottom;
    return [...document.querySelectorAll("li.film h3 a")].findIndex((a) => {
      const r = a.getBoundingClientRect();
      return r.top >= top && r.bottom <= window.innerHeight;
    });
  });
  await page.locator("li.film h3 a").nth(index).click();
  await expect(page).toHaveURL(/\/film\//);
  await page.goBack({ waitUntil: "commit" });
  await expect(page.getByRole("heading", { level: 1, name: "This week" })).toBeAttached();
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 3000 }).toBeCloseTo(before, -2);
});
