// Full-page screenshots of every registered page × state at the five widths,
// written to shots/<page>-<state>-<width>.png at the repo root.
import path from "node:path";
import { test } from "./fixtures.ts";
import { PAGES } from "./pages.ts";
import { VIEWPORTS, contextFor } from "./viewports.ts";

const SHOTS = path.join(import.meta.dirname, "../../shots");

for (const entry of PAGES) {
  for (const viewport of VIEWPORTS) {
    test.describe(`${entry.page}/${entry.state} at ${viewport.width}`, () => {
      test.use(contextFor(viewport));

      test("shot", async ({ page }) => {
        await page.goto(entry.path);
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.screenshot({
          path: path.join(SHOTS, `${entry.page}-${entry.state}-${viewport.width}.png`),
          fullPage: true,
          animations: "disabled",
        });
      });
    });
  }
}
