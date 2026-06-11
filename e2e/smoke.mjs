// End-to-end smoke test: boots the Flask API (with a date-shifted copy of the
// local listings cache) and the Vite dev server on scratch ports, then drives
// the app in headless Chromium through the core flows.
//
//   npm run e2e
//
// Requires cache/listings.json (run `npm run refresh-cache` to create it) and
// Playwright's Chromium (`npx playwright install chromium`).

import { chromium } from "playwright";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const API_PORT = 5005;
const WEB_PORT = 5180;
const BASE = `http://localhost:${WEB_PORT}`;
const ROOT = path.dirname(new URL(import.meta.url).pathname) + "/..";

// ── Fixture: shift cached listings so showtimes land on upcoming days ──────
const cachePath = path.join(ROOT, "cache", "listings.json");
if (!fs.existsSync(cachePath)) {
  console.error("e2e: cache/listings.json not found — run `npm run refresh-cache` first");
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
const allDates = data.movies.flatMap((m) => (m.showtimes ?? []).map((s) => s.date));
const minDate = new Date(`${allDates.sort()[0]}T00:00:00`);
const today = new Date();
today.setHours(0, 0, 0, 0);
const deltaDays = Math.round((today - minDate) / 86400000);
for (const m of data.movies) {
  for (const s of m.showtimes ?? []) {
    const d = new Date(`${s.date}T00:00:00`);
    d.setDate(d.getDate() + deltaDays);
    s.date = d.toISOString().slice(0, 10);
  }
}
data.fetched_at = new Date().toISOString();
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "bmd-e2e-"));
fs.writeFileSync(path.join(cacheDir, "listings.json"), JSON.stringify(data));

// ── Servers ─────────────────────────────────────────────────────────────────
const children = [];
function start(cmd, args, env) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "ignore",
    detached: false,
  });
  children.push(child);
  return child;
}
function cleanup() {
  for (const c of children) c.kill("SIGTERM");
  fs.rmSync(cacheDir, { recursive: true, force: true });
}
process.on("exit", cleanup);

async function waitFor(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
}

start("python3", ["app.py"], { PORT: String(API_PORT), CACHE_DIR: cacheDir });
start("npx", ["vite", "--port", String(WEB_PORT), "--strictPort"], {
  API_PROXY_TARGET: `http://localhost:${API_PORT}`,
});
await waitFor(`http://localhost:${API_PORT}/api/listings`);
await waitFor(BASE);

// ── Drive ───────────────────────────────────────────────────────────────────
const failures = [];
const consoleErrors = [];
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    console.log(`FAIL  ${name} ${detail}`);
    failures.push(name);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(BASE);
await page.waitForSelector(".film-card", { timeout: 15000 });
check("list renders film cards", (await page.locator(".film-card").count()) > 0);

// Day filter → URL
await page.locator(".day-chip").nth(2).click();
await page.waitForTimeout(200);
check("day filter in URL", page.url().includes("day=1"), page.url());

// Scroll deep, open a visible card, come back
await page.evaluate(() => window.scrollTo(0, 800));
await page.waitForTimeout(200);
const scrollBefore = await page.evaluate(() => window.scrollY); // may clamp short of 800
// Click a card already fully in view — Playwright auto-scrolls to offscreen
// targets, which would corrupt the scroll-restore assertion
const visibleIdx = await page.evaluate(() =>
  [...document.querySelectorAll(".film-card")].findIndex((c) => {
    const r = c.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  }),
);
await page.locator(".film-card").nth(visibleIdx).click();
await page.waitForSelector(".detail-film-title");
check("detail keeps day param", page.url().includes("day=1"), page.url());
check(
  "detail pre-selects day chip",
  (await page.locator(".detail-screen .day-chip--active").count()) === 1,
);
await page.locator(".detail-back-btn").click();
await page.waitForSelector(".film-card");
check("back keeps filters", page.url().includes("day=1"), page.url());
const scrollRestored = await page
  .waitForFunction((y) => Math.abs(window.scrollY - y) < 50, scrollBefore, { timeout: 3000 })
  .then(() => true)
  .catch(() => false);
check(
  "back restores scroll",
  scrollBefore > 0 && scrollRestored,
  `scrollY=${await page.evaluate(() => window.scrollY)} expected≈${scrollBefore}`,
);

// Search survives a detail round-trip
await page.evaluate(() => window.scrollTo(0, 0));
await page.locator('button[aria-label="Search films"]').click();
await page.waitForSelector(".search-input");
await page.locator(".search-input").fill("a");
await page.waitForTimeout(200);
check("search query in URL", page.url().includes("q=a"), page.url());
await page.locator(".film-card").first().click();
await page.waitForSelector(".detail-film-title");
await page.goBack();
await page.waitForSelector(".search-input");
check("back restores search", (await page.locator(".search-input").inputValue()) === "a");
await page.locator(".search-cancel").click();
await page.waitForTimeout(200);
check("cancel clears query param", !page.url().includes("q="), page.url());

// Cinema view + venue dialog
await page.locator(".view-tab", { hasText: "By Cinema" }).click();
await page.waitForSelector(".cinema-group", { timeout: 5000 });
check("cinema view renders groups", (await page.locator(".cinema-group").count()) > 0);
check("near-me toggle present", (await page.locator(".near-btn").count()) === 1);

// Cinema header in the list view opens the venue sheet
await page.locator(".cinema-group__header").first().click();
await page.waitForTimeout(300);
check("list cinema header opens sheet", (await page.locator(".cinema-dialog[open]").count()) === 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

await page.locator(".cinema-group__film").first().click();
await page.waitForSelector(".detail-film-title");
await page.locator(".cinema-row__header").first().click();
await page.waitForTimeout(300);
check("venue dialog opens", (await page.locator(".cinema-dialog[open]").count()) === 1);

// Deep link to a late day: active chip must be scrolled into view (row only,
// without disturbing vertical scroll)
await page.goto(`${BASE}/?day=6`);
await page.waitForSelector(".day-chip--active");
const chipVisible = await page.evaluate(() => {
  const el = document.querySelector(".day-chip--active");
  const row = el?.parentElement;
  if (!el || !row) return false;
  const er = el.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  return er.left >= rr.left && er.right <= rr.right + 1;
});
check("deep-linked day chip in view", chipVisible);

// No console errors before the deliberate-failure section below
check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));

// Stale-while-revalidate: with the API dead, a repeat visit must still paint
// from the localStorage cache (the aborted fetch logs expected errors)
check(
  "listings cached locally",
  await page.evaluate(() => localStorage.getItem("btw-listings") !== null),
);
await ctx.route("**/api/listings", (route) => route.abort());
await page.goto(BASE);
await page.waitForSelector(".film-card", { timeout: 5000 });
check("cached paint with API down", (await page.locator(".film-card").count()) > 0);

await browser.close();
console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
