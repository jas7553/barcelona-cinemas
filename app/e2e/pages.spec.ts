import { checkAxe } from "./checks/axe.ts";
import { watchConsole } from "./checks/console.ts";
import { watchCsp } from "./checks/csp.ts";
import { checkExternalLinks } from "./checks/external-links.ts";
import { checkFocus } from "./checks/focus.ts";
import { checkHtml } from "./checks/html.ts";
import { watchNetwork } from "./checks/network.ts";
import { checkNoOverflow } from "./checks/overflow.ts";
import { checkNoSeparators } from "./checks/separators.ts";
import { checkTapTargets } from "./checks/tap-targets.ts";
import { checkTimes } from "./checks/times.ts";
import { expect, test } from "./fixtures.ts";
import { PAGES } from "./pages.ts";
import { softCheck } from "./soft.ts";
import { KEY_VIEWPORTS, VIEWPORTS, contextFor } from "./viewports.ts";

for (const entry of PAGES) {
  const name = `${entry.page}/${entry.state}`;

  test(`${name}: served HTML is valid`, async ({ request, browserName }) => {
    test.skip(browserName !== "chromium", "the served HTML is the same for every browser");
    const response = await request.get(entry.path);
    expect(response.ok()).toBe(true);
    await checkHtml(await response.text());
  });

  for (const viewport of VIEWPORTS) {
    test.describe(`${name} at ${viewport.width}`, () => {
      test.use(contextFor(viewport));

      test("brief rules", async ({ page, baseURL }) => {
        const network = await watchNetwork(page, new URL(baseURL ?? "").origin);
        const csp = await watchCsp(page);
        const consoleErrors = watchConsole(page);
        await page.goto(entry.path);
        await page.waitForLoadState("networkidle");

        await softCheck("no horizontal overflow", () => checkNoOverflow(page));
        await softCheck("targets ≥ 44×44", () => checkTapTargets(page));
        await softCheck("external links end in ↗", () => checkExternalLinks(page));
        await softCheck("no · or • separators", () => checkNoSeparators(page));
        await softCheck("times are HH:MM", () => checkTimes(page));
        await softCheck("same-origin and TMDb requests only", () => {
          network.check();
        });
        await softCheck("no CSP violations", () => {
          csp.check();
        });
        await softCheck("no console errors", () => {
          consoleErrors.check();
        });
      });

      if (KEY_VIEWPORTS.includes(viewport)) {
        test("axe", async ({ page }) => {
          await page.goto(entry.path);
          await checkAxe(page);
        });

        test("keyboard focus", async ({ page }) => {
          await page.goto(entry.path);
          await checkFocus(page);
        });
      }
    });
  }
}
