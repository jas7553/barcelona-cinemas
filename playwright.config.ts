import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import { buildFixtureCache } from "./e2e/fixture";

const API_PORT = 5005;
const WEB_PORT = 5180;
const BASE = `http://localhost:${WEB_PORT}`;

// Built at config load — guaranteed before the webServers start, so the Flask
// app can be pointed at the date-shifted cache via CACHE_DIR.
const cacheDir = buildFixtureCache();
process.on("exit", () => fs.rmSync(cacheDir, { recursive: true, force: true }));

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // The flows are stateful (scroll restoration, SWR cache) — keep them serial
  // and on a single worker rather than racing parallel browsers.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE,
    trace: "on-first-retry",
  },

  // iPhone 13 geometry (390×844, mobile, touch) but on Chromium — matches the
  // original smoke harness; the device preset's WebKit default is overridden.
  projects: [
    { name: "mobile-chromium", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],

  webServer: [
    {
      command: "python3 app.py",
      url: `http://localhost:${API_PORT}/api/listings`,
      env: { PORT: String(API_PORT), CACHE_DIR: cacheDir },
      // Never reuse a pre-existing server — that risks testing stale code.
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: BASE,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
