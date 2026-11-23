import { checkBfcache } from "./checks/bfcache.ts";
import { expect, test } from "./fixtures.ts";
import { PAGES, awayFrom } from "./pages.ts";
import { KEY_VIEWPORTS, contextFor } from "./viewports.ts";

// Back flows: one at a time, so a busy machine doesn't stretch their waits.
test.describe.configure({ mode: "default" });

for (const entry of PAGES) {
  for (const viewport of KEY_VIEWPORTS) {
    test.describe(`${entry.page}/${entry.state} at ${viewport.width}`, () => {
      test.use(contextFor(viewport));

      test("Back restores from bfcache", async ({ page }) => {
        await checkBfcache(page, entry.path, awayFrom(entry));
      });
    });
  }
}

// This Chromium ignores unload handlers (a Permissions Policy default) and
// caches Cache-Control: no-store pages; an error status still blocks bfcache.
test("the bfcache check fails on a page that blocks bfcache", async ({ page }) => {
  await page.route("**/bad/bfcache", async (route) => {
    await route.fulfill({ response: await route.fetch(), status: 503 });
  });
  await expect(checkBfcache(page, "/bad/bfcache", "/")).rejects.toThrow(
    /wasn't restored.*response-status-not-ok/,
  );
});
