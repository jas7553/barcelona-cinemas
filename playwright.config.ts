import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import { buildFixtureCache } from "./e2e/fixture";
// @ts-expect-error — plain ESM helper, no types
import { SITE_TIMEZONE } from "./scripts/site-constants.mjs";

const WEB_PORT = 5180;
const BASE = `http://localhost:${WEB_PORT}`;

// Built at config load — a date-shifted internal cache. The webServer command
// exports it to the public listings JSON the static render reads.
const cacheDir = buildFixtureCache();
process.on("exit", () => fs.rmSync(cacheDir, { recursive: true, force: true }));

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // The flows are stateful (filters, native scroll restoration) — keep them
  // serial and on a single worker rather than racing parallel browsers.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE,
    trace: "on-first-retry",
    // Both halves of the render must agree on the zone: the browser context
    // (client hydration) and the static render below. Unpinned, these passed
    // only because CI happens to be UTC.
    timezoneId: SITE_TIMEZONE,
  },

  projects: [
    {
      // iPhone 13 geometry on full Chromium (not the headless shell, which never
      // restores from bfcache) with Playwright's bfcache opt-out removed, so
      // Back really does come out of the back/forward cache.
      name: "mobile-chromium",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        channel: "chromium",
        launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] },
      },
    },
    // Safari's engine for layout and behaviour. Playwright's WebKit never
    // restores from bfcache, so the bfcache specs skip themselves here.
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"] },
      // Specs for the old pages, which never ran on WebKit; they go with those pages.
      testIgnore: ["**/smoke.spec.ts", "**/a11y.spec.ts"],
    },
  ],

  // Build, export the date-shifted fixture, render it, and serve static/ the
  // way CloudFront does (e2e/serve.mjs: clean URLs, 404 page, production CSP).
  webServer: {
    command:
      "npm run build && python3 scripts/export_listings.py && node scripts/render.mjs && " +
      `node e2e/serve.mjs ${WEB_PORT}`,
    url: BASE,
    env: { CACHE_DIR: cacheDir, TZ: SITE_TIMEZONE },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
