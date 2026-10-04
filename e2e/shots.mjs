// Screenshots of the built site in the prototype's reference states, for side-
// by-side comparison with design/prototype/shots/final/. Not a test: the
// prototype is a visual reference, not a pixel spec.
//
//   npm run build
//   RENDER_DATA=design/prototype/listings.json RENDERED_AT=2026-10-04T15:30:00Z \
//     TZ=Europe/Madrid node scripts/render.mjs
//   node e2e/serve.mjs 5181 &
//   node e2e/shots.mjs [out dir, default /tmp/bmd-shots]
//
// The clock is the prototype's (Sun 4 Oct 17:30 Madrid) and Home is in Gràcia.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.SHOTS_BASE ?? "http://localhost:5181";
const OUT = process.argv[2] ?? "/tmp/bmd-shots";
const NOW = new Date("2026-10-04T15:30:00Z");
const HOME = { lat: 41.4021, lng: 2.1558 };

const SIZES = { m: { width: 390, height: 844 }, d: { width: 1280, height: 860 } };

/** name → [size, path, optional interaction] */
const SHOTS = {
  "10-m-home": ["m", "/privacy/", openHome],
  "11-m-home-denied": ["m", "/privacy/", async (page) => {
    await openHome(page);
    await page.getByRole("button", { name: "Use my current location" }).click();
    await page.getByText("Location access is off").waitFor();
  }],
  "17-m-privacy": ["m", "/privacy/"],
  "18-m-404": ["m", "/no-such-page/"],
  "25-d-home": ["d", "/privacy/", openHome],
};

async function openHome(page) {
  await page.getByRole("navigation", { name: "Site" }).getByRole("button").click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(300); // let the sheet's entrance animation finish
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const only = process.env.SHOTS_ONLY?.split(",");
for (const [name, [size, url, interact]] of Object.entries(SHOTS)) {
  if (only && !only.includes(name)) continue;
  const context = await browser.newContext({ viewport: SIZES[size], timezoneId: "Europe/Madrid" });
  await context.addInitScript((home) => localStorage.setItem("btw-home", JSON.stringify(home)), HOME);
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  await page.goto(BASE + url);
  await page.evaluate(() => document.fonts.ready);
  if (interact) await interact(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  await context.close();
}
await browser.close();
console.log(`[shots] wrote ${OUT}`);
