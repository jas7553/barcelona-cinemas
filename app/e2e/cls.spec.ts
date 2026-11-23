import { checkCls } from "./checks/cls.ts";
import { expect, test } from "./fixtures.ts";
import { PAGES, awayFrom } from "./pages.ts";
import { KEY_VIEWPORTS, contextFor } from "./viewports.ts";

// Timed flows: one at a time, so a busy machine doesn't stretch their windows.
test.describe.configure({ mode: "default" });

for (const entry of PAGES) {
  for (const viewport of KEY_VIEWPORTS) {
    test.describe(`${entry.page}/${entry.state} at ${viewport.width}`, () => {
      test.use(contextFor(viewport));

      test("CLS < 0.02 on load, reload and Back", async ({ page }) => {
        await checkCls(page, entry.path, awayFrom(entry));
      });
    });
  }
}

test("the CLS check fails on a page that shifts after load", async ({ page }) => {
  await expect(checkCls(page, "/bad/layout-shift", "/")).rejects.toThrow(/CLS ≥ 0\.02/);
});
