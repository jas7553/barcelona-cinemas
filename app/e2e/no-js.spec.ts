import { checkNoJs } from "./checks/no-js.ts";
import { test } from "./fixtures.ts";
import { PAGES } from "./pages.ts";
import { VIEWPORTS, contextFor } from "./viewports.ts";

test.use({ javaScriptEnabled: false });

for (const entry of PAGES) {
  for (const viewport of VIEWPORTS) {
    test.describe(`${entry.page}/${entry.state} at ${viewport.width}`, () => {
      test.use(contextFor(viewport));

      test("works without JavaScript", async ({ page }) => {
        await checkNoJs(page, entry);
      });
    });
  }
}
