// `npm run shots` and `npm run budgets`: the e2e config's server and settings,
// with their own projects, so `npm run e2e` doesn't run them.
import { defineConfig, devices } from "@playwright/test";
import e2e from "./playwright.config.ts";

const chromium = { ...devices["Desktop Chrome"], channel: "chromium" } as const;

export default defineConfig({
  ...e2e,
  retries: 0,
  reporter: [["list"]],
  projects: [
    { name: "shots", testMatch: "shots.tool.ts", use: chromium },
    { name: "budgets", testMatch: "budgets.tool.ts", use: chromium },
  ],
});
