import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import { buildFixtureCache } from "./e2e/fixture";
// @ts-expect-error — plain ESM helper, no types
import { SITE_TIMEZONE } from "./scripts/site-constants.mjs";

const WEB_PORT = 5180;
const BASE = `http://localhost:${WEB_PORT}`;

// Built at config load — a date-shifted internal cache. The webServer command
// exports it to the public listings JSON the dev SSG server renders pages from.
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
    // (client hydration) and the dev SSG server below (server render). Unpinned,
    // these passed only because CI happens to be UTC.
    timezoneId: SITE_TIMEZONE,
  },

  // iPhone 13 geometry (390×844, mobile, touch) but on Chromium — matches the
  // original smoke harness; the device preset's WebKit default is overridden.
  projects: [
    { name: "mobile-chromium", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],

  // Export the date-shifted fixture to the public listings JSON, then serve the
  // MPA via the dev SSG server (renders / and /film/<id> on the fly from it).
  // No API server — the data is embedded in each static document.
  webServer: {
    command: `python3 scripts/export_listings.py && npx vite --port ${WEB_PORT} --strictPort`,
    url: BASE,
    env: { CACHE_DIR: cacheDir, TZ: SITE_TIMEZONE },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
