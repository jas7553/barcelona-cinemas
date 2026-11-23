import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";
import { MADRID_TZ } from "../shared/madrid.ts";

/**
 * E2E_PORT, or a free port. Workers load this file again, so the pick goes
 * back into the environment they inherit.
 */
function port(): number {
  const fromEnv = process.env["E2E_PORT"];
  const chosen =
    fromEnv ??
    execFileSync(
      process.execPath,
      [
        "-e",
        "const s = require('node:net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); });",
      ],
      { encoding: "utf8" },
    ).trim();
  process.env["E2E_PORT"] = chosen;
  return Number(chosen);
}

const PORT = port();
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CI = Boolean(process.env["CI"]);

/** iPhone geometry on full Chromium: the headless shell never restores from bfcache. */
const chromium = { ...devices["iPhone 13"], browserName: "chromium", channel: "chromium" } as const;

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  ...(CI ? { workers: 2 } : {}),
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    timezoneId: MADRID_TZ,
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      testIgnore: ["cls.spec.ts", "scroll.spec.ts"],
      use: {
        ...chromium,
        // Playwright turns bfcache off by default; Back has to really restore.
        launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] },
      },
    },
    {
      // Back here is a real reload, so its layout shifts are counted.
      name: "chromium-no-bfcache",
      testMatch: "cls.spec.ts",
      use: chromium,
    },
    {
      // Safari's engine. It reports no layout shifts (scroll.spec.ts stands in for
      // cls.spec.ts), and Playwright's WebKit never restores from bfcache.
      name: "webkit",
      testIgnore: ["cls.spec.ts", "bfcache.spec.ts"],
      use: devices["iPhone 13"],
    },
  ],

  // The seam: the renderer replaces this server, at the same baseURL.
  webServer: {
    command: "npx tsx stub-server.ts",
    url: BASE_URL,
    env: { E2E_PORT: String(PORT) },
    reuseExistingServer: false,
    stdout: "ignore",
  },
});
