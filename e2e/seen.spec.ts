import { test, expect } from "@playwright/test";

// Note: Playwright does not bfcache-restore on goBack(), so the iOS swipe-back
// path (pageshow persisted=true) is covered by the unit test in useSeenFilms.
test("mark as seen on the film page moves it into the list's Seen section", async ({ page }) => {
  await page.goto("/");
  const first = page.locator("#film-list a.film-card").first();
  const title = await first.locator(".film-card__title").innerText();
  await first.click();
  await page.waitForURL(/\/film\//);

  await page.getByRole("button", { name: "Mark as seen" }).click();
  await expect(page.getByRole("button", { name: "Mark as unseen" })).toBeVisible();

  await page.goto("/");
  await expect(page.locator("#film-list a.film-card").first().locator(".film-card__title")).not.toHaveText(title);
  const toggle = page.locator(".seen-section__toggle");
  await expect(toggle).toHaveText(/Seen \(1\)/);
  await toggle.click();
  await expect(page.locator(".film-card--seen .film-card__title")).toHaveText(title);
});
