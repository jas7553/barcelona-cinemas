import { checkScrollRestore } from "./checks/scroll-restore.ts";
import { expect, test } from "./fixtures.ts";
import { PAGES, awayFrom } from "./pages.ts";
import { KEY_VIEWPORTS, contextFor } from "./viewports.ts";

// Timed flows: one at a time, so a busy machine doesn't stretch their windows.
test.describe.configure({ mode: "default" });

for (const entry of PAGES) {
  for (const viewport of KEY_VIEWPORTS) {
    test.describe(`${entry.page}/${entry.state} at ${viewport.width}`, () => {
      test.use(contextFor(viewport));

      test("reload and Back land where the page was left, and stay", async ({ page }) => {
        await checkScrollRestore(page, entry.path, awayFrom(entry));
      });
    });
  }
}

test("the scroll check fails on a page that shifts after load", async ({ page }) => {
  await expect(checkScrollRestore(page, "/bad/layout-shift", "/")).rejects.toThrow(
    /heading \d+ at/,
  );
});
