// Cinema pages and the Cinemas index on the static build, under the production
// CSP, on the date-shifted fixture.

import { expect, test, type Page } from "@playwright/test";
import { collectErrors, expectHit44, HOME, readCls, seedPrefs, slowBundle, watchCls } from "./helpers";

/** The cinemas on the index, top to bottom as painted (CSS order included). */
async function paintedCinemas(page: Page): Promise<string[]> {
  return page.locator("li.cinema").evaluateAll((els) =>
    els
      .map((e) => ({ id: e.getAttribute("data-id")!, top: e.getBoundingClientRect().top }))
      .sort((a, b) => a.top - b.top)
      .map((e) => e.id),
  );
}

test("the ticket's cinema link opens that cinema's day, under the production CSP", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  const day = (await page.getByRole("navigation", { name: "Days" }).getByRole("link").nth(2).getAttribute("href"))!;
  await page.goto(day);
  await page.waitForLoadState("networkidle");
  await page.locator("li.film a.chip[aria-haspopup]").first().click();
  const cinema = page.getByRole("dialog").locator(".where a");
  const href = (await cinema.getAttribute("href"))!;
  await cinema.click();
  await expect(page).toHaveURL(href);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('.strip [aria-current="date"]')).toHaveCount(1);
  await expect(page.locator("li.film").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("a week cell leads to the Day view, at that film", async ({ page }) => {
  await page.goto("/cinemas/");
  await page.locator("li.cinema a").first().click();
  await expect(page.getByRole("heading", { name: /films? this week/ })).toBeVisible();
  const cell = page.locator("a.cell--on").first();
  const href = (await cell.getAttribute("href"))!;
  expect(href).toMatch(/^\/cinema\/[^/]+\/\d{4}-\d{2}-\d{2}\/#f.+$/);
  await cell.click();
  await expect(page.locator(href.slice(href.indexOf("#")))).toBeVisible();
  await expect(page.locator(`${href.slice(href.indexOf("#"))} a.chip[aria-haspopup]`).first()).toBeVisible();
});

test("a dot on the Cinemas map opens that cinema", async ({ page }) => {
  await page.goto("/cinemas/");
  await page.waitForLoadState("networkidle");
  // Dots in a cluster overlap, so the one on top may be a neighbour's: any cinema will do.
  const dot = page.locator("svg.map:visible a").first();
  await expect(dot).toHaveAttribute("href", /^\/cinema\/[^/]+\/$/);
  await dot.locator(".m-hit").click({ force: true });
  await expect(page).toHaveURL(/\/cinema\/[^/]+\/$/);
});

test("starring a cinema puts it under My cinemas on the index", async ({ page }) => {
  await page.goto("/cinemas/");
  const last = (await paintedCinemas(page)).at(-1)!;
  await page.goto(`/cinema/${last}/`);
  const toggle = page.getByRole("button", { name: /Add to my cinemas/ });
  await toggle.click();
  await expect(page.locator(".pill--fav")).toHaveAttribute("aria-pressed", "true");
  await page.goto("/cinemas/");
  await expect(page.getByText("My cinemas", { exact: true })).toBeVisible();
  expect((await paintedCinemas(page))[0]).toBe(last);
  await expect(page.locator(`[data-fav="${last}"].star`)).toHaveAttribute("aria-pressed", "true");
});

test.describe("before the bundle runs", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
  });

  test("My cinemas are already first and starred on the index", async ({ page }) => {
    await page.goto("/cinemas/");
    await expect(page.getByText("My cinemas", { exact: true })).toBeHidden();
    await expect(page.locator(".if-no-fav")).toBeVisible();
    const last = (await paintedCinemas(page)).at(-1)!;
    await seedPrefs(page, { fav: [last], home: HOME });
    await page.goto("/cinemas/");
    expect((await paintedCinemas(page))[0]).toBe(last);
    await expect(page.getByText("My cinemas", { exact: true })).toBeVisible();
    await expect(page.locator(".if-has-fav")).toBeVisible();
    await expect(page.locator(`[data-fav="${last}"]`)).toHaveAttribute("aria-pressed", "true");
  });

  test("a seen film already sorts last in a cinema's week", async ({ page }) => {
    await page.goto("/cinemas/");
    await page.locator("li.cinema a").first().click();
    const ids = await page.locator("li.film").evaluateAll((els) => els.map((e) => e.getAttribute("data-film")!));
    test.skip(ids.length < 2, "the cinema has a single film");
    const url = page.url();
    await seedPrefs(page, { seen: [ids[0]] });
    await page.goto(url);
    const painted = await page.locator("li.film").evaluateAll((els) =>
      els.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((e) => e.getAttribute("data-film")),
    );
    expect(painted.at(-1)).toBe(ids[0]);
  });
});

for (const path of ["/cinemas/", "cinema"]) {
  test(`${path === "/cinemas/" ? "Cinemas" : "a cinema's week"} with Home, My cinemas and a seen film doesn't shift when the bundle is slow`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "WebKit has no layout-shift entries");
    await page.goto("/cinemas/");
    const order = await paintedCinemas(page);
    const url = path === "/cinemas/" ? path : `/cinema/${order[0]}/`;
    if (url !== "/cinemas/") await page.goto(url);
    const seen = url === "/cinemas/" ? null : await page.locator("li.film").first().getAttribute("data-film");
    await slowBundle(page);
    await seedPrefs(page, { home: HOME, fav: order.slice(-2), seen: seen ? [seen] : undefined });
    await watchCls(page);
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const cls = await readCls(page);
    console.log(`[cls] ${url} with Home, My cinemas and a seen film: ${cls.toFixed(4)}`);
    expect(cls).toBeLessThan(0.02);
  });
}

test("cinema controls have 44px hit areas", async ({ page }) => {
  const check = async (selectors: string[]) => {
    for (const selector of selectors) await expectHit44(page.locator(selector).first(), selector);
  };
  await page.goto("/cinemas/");
  await check(["li.cinema a", ".star"]);
  await page.locator("li.cinema a").first().click();
  await expect(page.locator(".pill--fav")).toBeVisible();
  // The cross-document view transition's overlay takes every hit until it ends.
  await page.waitForFunction(() => document.getAnimations().length === 0);
  await check([".pill--fav", "a.cell--on"]);
});
