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
  const back = page.locator(".hero .back");
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

test("the day strip stays in view while a day's cinemas scroll", async ({ page }) => {
  const { id, date } = premiumShowing();
  await page.goto(`/film/${id}/${date}/`);
  const strip = panel(page).getByRole("navigation", { name: "Days" });
  const start = (await strip.boundingBox())!.y;
  await page.evaluate((y) => scrollBy(0, y), start + 200);
  await expect.poll(async () => (await strip.boundingBox())!.y).toBeLessThan(1);
  await expect.poll(async () => (await strip.boundingBox())!.y).toBeGreaterThan(-1);

  // Scrolling to a cinema stops below the strip rather than under it.
  const row = panel(page).locator(".crow-h").last();
  await row.evaluate((node) => node.scrollIntoView());
  const stripBottom = (await strip.boundingBox())!;
  expect((await row.boundingBox())!.y).toBeGreaterThanOrEqual(stripBottom.y + stripBottom.height - 1);
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
    // Centred, clear of the sticky strip (Playwright's WebKit scroll ignores scroll-margin).
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
