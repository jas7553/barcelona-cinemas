import { test, expect } from "@playwright/test";

// Note: Playwright does not bfcache-restore on goBack(), so the iOS swipe-back
// path (pageshow persisted=true) is covered by the unit test in useSeenFilms.
test("mark as seen on the film page moves it into the list's Seen section", async ({ page }) => {
  await page.goto("/");
  const first = page.locator("#film-list .film-card").first();
  const title = await first.locator(".film-card__title").innerText();
  await first.locator(".film-card__link").click();
  await page.waitForURL(/\/film\//);

  await page.getByRole("button", { name: "Mark as seen" }).click();
  await expect(page.getByRole("button", { name: "Mark as unseen" })).toBeVisible();

  await page.goto("/");
  await expect(page.locator("#film-list .film-card").first().locator(".film-card__title")).not.toHaveText(title);
  const toggle = page.locator(".seen-section__toggle");
  await expect(toggle).toHaveText("Seen");
  await expect(toggle).not.toContainText("(");
  await toggle.click();
  await expect(page.locator(".film-card--seen .film-card__title")).toHaveText(title);
});

test("toggling seen from the list moves the card between sections", async ({ page }) => {
  await page.goto("/");
  const first = page.locator("#film-list .film-card").first();
  const title = await first.locator(".film-card__title").innerText();

  await first.getByRole("button", { name: "Mark as seen" }).click();
  await expect(page.locator("#film-list .film-card").first().locator(".film-card__title")).not.toHaveText(title);

  const toggle = page.locator(".seen-section__toggle");
  await expect(toggle).toHaveText("Seen");
  await toggle.click();
  const seenCard = page.locator(".film-card--seen");
  await expect(seenCard.locator(".film-card__title")).toHaveText(title);

  // Un-marking from within the Seen section moves it back.
  await seenCard.getByRole("button", { name: "Mark as unseen" }).click();
  await expect(page.locator("#film-list .film-card").first().locator(".film-card__title")).toHaveText(title);
});

test("reset clears all seen films after confirmation", async ({ page }) => {
  await page.goto("/");
  const first = page.locator("#film-list .film-card").first();
  await first.getByRole("button", { name: "Mark as seen" }).click();

  const toggle = page.locator(".seen-section__toggle");
  await toggle.click();
  await page.getByRole("button", { name: "Reset" }).click();

  await expect(page.getByRole("heading", { name: "Clear seen films?" })).toBeVisible();

  // Cancel leaves the seen film in place. Section stays expanded, so Reset
  // is reachable again without re-toggling.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".seen-section")).toBeVisible();

  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByRole("button", { name: "Clear" }).click();

  await expect(page.locator(".seen-section")).toHaveCount(0);
});
