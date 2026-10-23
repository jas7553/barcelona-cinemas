// The film page on the static build, under the production CSP, on the
// date-shifted fixture.

import { expect, test, type Page } from "@playwright/test";
import { premiumShowing } from "./fixture";
import { collectErrors, expectHit44, seedPrefs } from "./helpers";

const panel = (page: Page) => page.getByRole("region", { name: "Showtimes" });

/** The dated page with the injected IMAX showing: the whole premium-format chain, data to DOM. */
async function gotoPremium(page: Page) {
  const { id, date } = premiumShowing();
  await page.goto(`/film/${id}/${date}/`);
  await page.waitForLoadState("networkidle");
  return { id, date };
}

test("a film page renders its showings by cinema and hydrates under the production CSP", async ({ page }) => {
  const errors = collectErrors(page);
  const { id, date } = await gotoPremium(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(panel(page).getByRole("navigation", { name: "Days" }).locator('[aria-current="date"]')).toHaveAttribute(
    "href",
    `/film/${id}/${date}/`,
  );
  const cinema = panel(page).locator(".crow-h").first();
  await expect(cinema).toHaveAttribute("href", new RegExp(`^/cinema/[^/]+/${date}/$`));
  await expect(panel(page).locator(".tag--imax").first()).toHaveText("IMAX");
  expect(errors).toEqual([]);
});

test("a film page has the site header, a way back, and its backdrop uncropped across the column", async ({ page }) => {
  await gotoPremium(page);
  const nav = page.getByRole("navigation", { name: "Site" });
  await expect(nav.getByRole("link", { name: "Barcelona This Week" })).toBeVisible();
  await expect(nav.getByRole("button")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Cinemas" })).toBeVisible();
  await expect(page.locator(".back")).toHaveText("‹ This week");

  const backdrop = page.locator("img.backdrop");
  test.skip((await backdrop.count()) === 0, "the fixture film has no backdrop");
  const { w, h, column } = await backdrop.evaluate((img) => {
    const wrap = img.parentElement!;
    const pad = parseFloat(getComputedStyle(wrap).paddingLeft) + parseFloat(getComputedStyle(wrap).paddingRight);
    const r = img.getBoundingClientRect();
    return { w: r.width, h: r.height, column: wrap.clientWidth - pad };
  });
  expect(w).toBeCloseTo(column, 0);
  expect(Math.abs(h - (w * 9) / 16)).toBeLessThan(1);
});

test("film page showtime chips are named with time, cinema, day and whether they book", async ({ page }) => {
  await gotoPremium(page);
  const name = /^\d{2}:\d{2}.*, \w+day \d{1,2} \w+, (book tickets|no booking page, cinema site)$/;
  await expect(panel(page).getByRole("link", { name }).first()).toBeVisible();
});

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
]) {
  test(`on a ${width}x${height} desktop the first showtime is above the fold, behind a capped 16:9 backdrop`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await gotoPremium(page);
    const backdrop = page.locator("img.backdrop");
    test.skip((await backdrop.count()) === 0, "the fixture film has no backdrop");
    expect((await panel(page).locator("a.chip").first().boundingBox())!.y).toBeLessThan(height);
    const box = (await backdrop.boundingBox())!;
    expect(Math.abs(box.height - (box.width * 9) / 16)).toBeLessThan(1);
    expect(box.height).toBeLessThanOrEqual(340);
  });
}

test("a showtime opens its ticket, with this showing's booking link or the cinema website", async ({ page }) => {
  await gotoPremium(page);
  const chip = panel(page).locator("a.chip[aria-haspopup]").first();
  const time = (await chip.locator("b").textContent())!;
  await chip.click();
  const ticket = page.getByRole("dialog");
  await expect(ticket).toContainText(time);

  const payload = await page.evaluate(() => JSON.parse(document.getElementById("__APP_DATA__")!.textContent!));
  const primary = ticket.locator(".cta");
  const href = (await primary.getAttribute("href"))!;
  if ((await primary.textContent())!.startsWith("Book at")) {
    expect(payload.film.showtimes.map((s: { booking_url?: string }) => s.booking_url)).toContain(href);
  } else {
    expect(payload.theaters.map((t: { website_url: string }) => t.website_url)).toContain(href);
  }
  await page.goBack();
  await expect(ticket).toBeHidden();
});

test("the undated page opens on the first day with showings left", async ({ page }) => {
  const { id } = premiumShowing();
  await page.goto(`/film/${id}/`);
  const current = panel(page).getByRole("navigation", { name: "Days" }).locator('[aria-current="date"]');
  await expect(current).toHaveCount(1);
  await expect(panel(page).locator("a.chip[aria-haspopup]").first()).toBeVisible();
});

test("day hops replace history and keep the way back to the cinema", async ({ page }) => {
  const { id, date } = premiumShowing();
  await page.goto(`/film/${id}/${date}/`);
  const cinema = (await panel(page).locator(".crow-h").first().getAttribute("href"))!;
  await page.goto(cinema);
  await page.locator(`a[href^="/film/${id}/"]`).first().click();
  const back = page.locator(".back");
  await expect(back).toHaveAttribute("href", new RegExp(`^${cinema.replace(/[^/]+\/$/, "")}`));
  const label = (await back.textContent())!;

  const other = panel(page).getByRole("navigation", { name: "Days" }).locator("a.sd:not([aria-current])").first();
  test.skip((await other.count()) === 0, "the film shows on a single day");
  const next = (await other.getAttribute("href"))!;
  await other.click();
  await expect(page).toHaveURL(next);
  await expect(back).toHaveText(label);

  // The cinema page may come back from bfcache, which fires no load event.
  await page.goBack({ waitUntil: "commit" });
  await expect(page).toHaveURL(new RegExp(`${cinema.replace(/[^/]+\/$/, "")}`));
});

/** Elements that scroll by themselves vertically, other than the page. */
const ownScrollers = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)
      .map((el) => String(el.className)),
  );

test("on a phone the map follows the showtimes, and only the page scrolls", async ({ page }) => {
  await gotoPremium(page);
  const map = page.locator(".film-map");
  test.skip((await map.count()) === 0, "every showing that day has started");
  const panelBox = (await panel(page).boundingBox())!;
  expect((await map.boundingBox())!.y).toBeGreaterThanOrEqual(panelBox.y + panelBox.height - 1);
  expect(await ownScrollers(page)).toEqual([]);
});

test("on desktop the map sits under the synopsis, and the showtimes panel grows with the page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoPremium(page);
  const map = page.locator(".film-map");
  test.skip((await map.count()) === 0, "every showing that day has started");
  await expect(map.locator("svg.map--d")).toBeVisible();
  const mapBox = (await map.boundingBox())!;
  const panelBox = (await panel(page).boundingBox())!;
  const aboutBox = (await page.locator(".about").boundingBox())!;
  expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(panelBox.x);
  expect(mapBox.y).toBeGreaterThanOrEqual(aboutBox.y + aboutBox.height - 1);
  // Right under the about column, not pushed down by the panel's height.
  expect(mapBox.y).toBeLessThan(aboutBox.y + aboutBox.height + 60);
  expect(await ownScrollers(page)).toEqual([]);
  // The panel's last row is reached by scrolling the page.
  const last = panel(page).locator(".crow").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  expect(await panel(page).evaluate((el) => el.scrollTop)).toBe(0);
});

test("every cinema on the film's map has a label", async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await gotoPremium(page);
    const svg = page.locator(".film-map svg:visible");
    test.skip((await svg.count()) === 0, "every showing that day has started");
    await expect(svg.locator(".m-label")).toHaveCount(await svg.locator(".m-dot").count());
  }
});

test("Seen it? marks the film, and This week shows it in Seen after Back from bfcache", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Playwright's WebKit never restores from bfcache");
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    window.addEventListener("pageshow", (e) => {
      (window as unknown as { restored: boolean }).restored = e.persisted;
    });
  });
  await page.goto("/");
  const title = (await page.locator("li.film h3").first().textContent())!;
  await page.locator("li.film h3 a").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

  const seen = page.getByRole("button", { name: /Seen it\?/ });
  await seen.click();
  await expect(page.getByRole("button", { name: /Seen/ })).toHaveAttribute("aria-pressed", "true");

  await page.goBack({ waitUntil: "commit" });
  await expect.poll(() => page.evaluate(() => (window as unknown as { restored?: boolean }).restored)).toBe(true);
  await expect(page.locator("details.seen summary")).toHaveText("Seen (1)");
  await expect(page.locator("details.seen h3", { hasText: title })).toBeAttached();
  expect(errors).toEqual([]);
});

test.describe("before the bundle runs", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/\/assets\/.*\.js$/, (route) => route.abort());
  });

  test("a seen film's toggle is already pressed", async ({ page }) => {
    const { id, date } = premiumShowing();
    await seedPrefs(page, { seen: [id] });
    await page.goto(`/film/${id}/${date}/`);
    await expect(page.locator(".pill--seen")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".pill--seen .if-off")).toBeHidden();
  });

  test("My cinemas already come first among the film's cinemas", async ({ page }) => {
    const { id, date } = premiumShowing();
    await page.goto(`/film/${id}/${date}/`);
    const ids = await page.locator(".crow").evaluateAll((els) => els.map((e) => e.getAttribute("data-id")!));
    test.skip(ids.length < 2, "the IMAX day has a single cinema");
    const last = ids[ids.length - 1];
    await seedPrefs(page, { fav: [last] });
    await page.goto(`/film/${id}/${date}/`);
    const top = await page.locator(".crow").evaluateAll((els) =>
      els.reduce((a, b) => (b.getBoundingClientRect().top < a.getBoundingClientRect().top ? b : a)).getAttribute("data-id"),
    );
    expect(top).toBe(last);
  });
});

test("film page controls have 44px hit areas", async ({ page }) => {
  await gotoPremium(page);
  const targets = [
    page.locator(".back"),
    page.locator(".actions .pill").first(),
    panel(page).locator(".days a").first(),
    panel(page).locator(".crow-h").first(),
    panel(page).locator("a.chip[aria-haspopup]").first(),
  ];
  for (const el of targets) {
    await el.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await expectHit44(el);
  }
});

test("no horizontal overflow at 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await gotoPremium(page);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  const { scrollW, clientW, offenders } = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    const off = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > cw + 1 && !el.closest(".days"))
      .map((el) => String(el.className));
    return { scrollW: document.documentElement.scrollWidth, clientW: cw, offenders: off.slice(0, 10) };
  });
  expect(scrollW, `overflow past ${clientW}: ${JSON.stringify(offenders)}`).toBeLessThanOrEqual(clientW + 1);
});
