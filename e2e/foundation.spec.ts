// The shared shell on the static build: header, footer, Home sheet, Privacy and
// the 404, served with the production CSP (e2e/serve.mjs).

import { expect, test, type Page } from "@playwright/test";

const HOME_KEY = "btw-home";
const GRACIA = { latitude: 41.4009, longitude: 2.1601 };

/** Console errors and uncaught exceptions, including CSP violations. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    // The 404 document itself arrives with a 404 status, which Chromium logs.
    if (msg.type() === "error" && !msg.text().includes("status of 404")) errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const homePill = (page: Page) => page.getByRole("navigation", { name: "Site" }).getByRole("button");
const homeSheet = (page: Page) => page.getByRole("dialog", { name: "Home" });

test("Privacy renders and hydrates under the production CSP without errors", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/privacy/");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await expect(page.locator("footer")).toContainText(/^Updated .+ · VO screenings only · Data from TMDb · Privacy$/);
  await homePill(page).click();
  await expect(homeSheet(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test("the Home pill shows a saved Home on first paint, before any JS bundle runs", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '{"lat":41.4,"lng":2.15}'), HOME_KEY);
  // Block the bundle: only the inline pre-paint script can have set the pill.
  await page.route("**/assets/*.js", (route) => route.abort());
  await page.goto("/privacy/");
  await expect(homePill(page)).toHaveAccessibleName("Home");
  await expect(page.getByText("Set home", { exact: true })).toBeHidden();
});

test.describe("Home sheet", () => {
  test("saves the current location as Home", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(GRACIA);
    await page.goto("/privacy/");
    await expect(homePill(page)).toHaveAccessibleName("Set home");

    await homePill(page).click();
    const save = homeSheet(page).getByRole("button", { name: "Save home here" });
    await expect(save).toBeDisabled();
    await homeSheet(page).getByRole("button", { name: "Use my current location" }).click();
    await expect(homeSheet(page).getByRole("status")).toHaveText("Found you. Save to use this as Home.");
    await save.click();

    await expect(homeSheet(page)).toBeHidden();
    await expect(homePill(page)).toHaveAccessibleName("Home");
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), HOME_KEY))!)).toEqual({
      lat: GRACIA.latitude,
      lng: GRACIA.longitude,
    });
  });

  test("drops a pin where the map is tapped, and saves it as Home", async ({ page }) => {
    await page.goto("/privacy/");
    await homePill(page).click();
    await page.waitForFunction(() => document.getAnimations().length === 0);
    const map = homeSheet(page).locator("svg.map:visible");
    await map.click({ position: { x: 120, y: 90 } });
    await expect(homeSheet(page).getByRole("status")).toHaveText("Pin dropped. Save to use it as Home.");
    await expect(map.locator(".m-home")).toHaveCount(1);
    await homeSheet(page).getByRole("button", { name: "Save home here" }).click();
    await expect(homePill(page)).toHaveAccessibleName("Home");
    const home = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), HOME_KEY))!);
    expect(home.lat).toBeGreaterThan(41.3);
    expect(home.lat).toBeLessThan(41.5);
  });

  test("says so when location access is refused", async ({ page }) => {
    await page.goto("/privacy/");
    await homePill(page).click();
    await homeSheet(page).getByRole("button", { name: "Use my current location" }).click();
    await expect(homeSheet(page).getByRole("status")).toContainText("Location access is off for this site.");
  });

  test("closes on Back without leaving the page", async ({ page }) => {
    await page.goto("/privacy/");
    await homePill(page).click();
    await expect(homeSheet(page)).toBeVisible();
    await page.goBack();
    await expect(homeSheet(page)).toBeHidden();
    await expect(page).toHaveURL(/\/privacy\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  });

  test("closes on Esc and gives its history entry back", async ({ page }) => {
    await page.goto("/");
    await page.goto("/privacy/");
    await homePill(page).click();
    await page.keyboard.press("Escape");
    await expect(homeSheet(page)).toBeHidden();
    // One Back now leaves the page, rather than popping a stale sheet entry.
    await page.goBack({ waitUntil: "commit" });
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("404", () => {
  test("a missing page says Not showing. with a 404 status", async ({ page }) => {
    const response = await page.goto("/no-such-page/");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Not showing." })).toBeVisible();
    await page.getByRole("link", { name: "See what's on this week" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("an expired day page goes on to This week", async ({ page }) => {
    await page.goto("/day/2020-01-01/");
    await expect(page).toHaveURL(/\/$/);
  });

  test("an expired dated film page goes on to the film, and stops there if that's gone too", async ({ page }) => {
    await page.goto("/film/no-such-film/2020-01-01/");
    await expect(page).toHaveURL(/\/film\/no-such-film\/$/);
    await expect(page.getByRole("heading", { name: "Not showing." })).toBeVisible();
  });
});

test("Back restores the page from bfcache with prefs changed elsewhere", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Playwright's WebKit never restores from bfcache");
  const errors = collectErrors(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(GRACIA);
  await page.addInitScript(() => {
    window.addEventListener("pageshow", (e) => {
      (window as unknown as { restored: boolean }).restored = e.persisted;
    });
  });

  await page.goto("/privacy/");
  await expect(homePill(page)).toHaveAccessibleName("Set home");

  // Set Home on another page…
  await page.goto("/no-such-page/");
  await homePill(page).click();
  await homeSheet(page).getByRole("button", { name: "Use my current location" }).click();
  await homeSheet(page).getByRole("button", { name: "Save home here" }).click();
  await expect(homeSheet(page)).toBeHidden();
  await expect(page).toHaveURL(/no-such-page/);

  // …then come back: the restored page must pick it up without a reload.
  await page.goBack({ waitUntil: "commit" });
  await expect(page).toHaveURL(/\/privacy\/$/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { restored?: boolean }).restored)).toBe(true);
  await expect(homePill(page)).toHaveAccessibleName("Home");
  expect(errors).toEqual([]);
});

/** Whether a tap 22px above and below the control's centre still lands on it. */
async function hitAreaIs44Tall(page: Page, name: string, locator: ReturnType<Page["locator"]>) {
  const ok = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return [y - 21.5, y + 21.5].every((py) => el.contains(document.elementFromPoint(x, py)));
  });
  expect(ok, `${name} hit area is under 44px tall`).toBe(true);
}

test("header and Home sheet controls have 44px hit areas", async ({ page }) => {
  await page.goto("/privacy/");
  const nav = page.getByRole("navigation", { name: "Site" });
  await hitAreaIs44Tall(page, "brand", nav.getByRole("link", { name: "Barcelona This Week" }));
  await hitAreaIs44Tall(page, "Home pill", homePill(page));
  await hitAreaIs44Tall(page, "Cinemas pill", nav.getByRole("link", { name: "Cinemas" }));
  await homePill(page).click();
  await page.waitForFunction(() => document.getAnimations().length === 0);
  for (const name of ["Use my current location", "Save home here", "Cancel"]) {
    await hitAreaIs44Tall(page, name, homeSheet(page).getByRole("button", { name }));
  }
});

test("a page with a saved Home doesn't shift as it hydrates", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "WebKit has no layout-shift entries");
  await page.addInitScript((key) => {
    localStorage.setItem(key, '{"lat":41.4,"lng":2.15}');
    (window as unknown as { cls: number }).cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) (window as unknown as { cls: number }).cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  }, HOME_KEY);
  await page.goto("/privacy/");
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => (window as unknown as { cls: number }).cls)).toBeLessThan(0.02);
});
