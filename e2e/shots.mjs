// Screenshots of the built site in the prototype's reference states, for side-
// by-side comparison with design/prototype/shots/final/. Not a test: the
// prototype is a visual reference, not a pixel spec.
//
//   npm run build
//   node e2e/shots.mjs --data            # writes the patched fixture below
//   RENDER_DATA=/tmp/bmd-shots-listings.json RENDERED_AT=2026-10-04T15:30:00Z \
//     TZ=Europe/Madrid node scripts/render.mjs
//   node e2e/serve.mjs 5181 &
//   node e2e/shots.mjs [out dir, default /tmp/bmd-shots]
//
// The clock is the prototype's (Sun 4 Oct 17:30 Madrid), Home is in Gràcia, and
// seen films and favourites are the prototype's seeds.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.SHOTS_BASE ?? "http://localhost:5181";
const NOW = new Date("2026-10-04T15:30:00Z");
const HOME = { lat: 41.4021, lng: 2.1558 };
const SEEN = ["1275779"];
const FAVOURITES = ["verdi", "verdi-park", "girona"];
const DATA_OUT = "/tmp/bmd-shots-listings.json";

// The prototype fixture has no booking links and no IMAX; the prototype patched
// them in the same way, so the ticket states are comparable.
if (process.argv[2] === "--data") {
  const data = JSON.parse(fs.readFileSync("design/prototype/listings.json", "utf8"));
  const bookable = new Set(["verdi", "verdi-park", "arenas", "aribau", "balmes", "glories"]);
  const imaxFilms = new Set(["1275779", "687163", "1228710"]);
  const imaxAt = new Set(["diagonal-mar", "maquinista", "filmax-granvia"]);
  for (const m of data.movies) {
    for (const s of m.showtimes) {
      if (bookable.has(s.theater_id)) s.booking_url = "https://example.com/book";
      if (imaxFilms.has(m.id) && imaxAt.has(s.theater_id) && s.time >= "19:00") s.premium_format = "imax";
    }
  }
  // 13: a film whose run is over, kept as an ended film. 16: the same film with no art.
  const masters = data.movies.find((m) => m.id === "454639");
  data.ended_movies = [{ ...masters, id: "454639-over", showtimes: [] }];
  Object.assign(masters, { poster_url: null, backdrop_url: null, runtime_minutes: null });
  fs.writeFileSync(DATA_OUT, JSON.stringify(data));
  console.log(`[shots] wrote ${DATA_OUT}`);
  process.exit(0);
}

const OUT = process.argv[2] ?? "/tmp/bmd-shots";
const SIZES = { m: { width: 390, height: 844 }, d: { width: 1280, height: 860 } };

/** name → [size, path, optional interaction, options] */
const SHOTS = {
  "01-m-week": ["m", "/", null, { fullPage: true }],
  "02-m-day": ["m", "/day/2026-10-06/"],
  "03-m-film": ["m", "/film/1275779/2026-10-05/", null, { fullPage: true }],
  "04-m-ticket-book": ["m", "/day/2026-10-04/", ticket("Book at")],
  "05-m-ticket-nobook": ["m", "/day/2026-10-04/", ticket("website")],
  "06-m-ticket-imax": ["m", "/day/2026-10-06/", ticket("IMAX")],
  "07-m-cinema-week": ["m", "/cinema/verdi/"],
  "08-m-cinema-day": ["m", "/cinema/verdi/2026-10-05/"],
  "09-m-cinemas": ["m", "/cinemas/"],
  "10-m-home": ["m", "/privacy/", openHome],
  "11-m-home-denied": ["m", "/privacy/", async (page) => {
    await openHome(page);
    await page.getByRole("button", { name: "Use my current location" }).click();
    await page.getByText("Location access is off").waitFor();
  }],
  "12-m-not-out": ["m", "/day/2026-10-10/"],
  "13-m-film-over": ["m", "/film/454639-over/"],
  "16-m-missing-art": ["m", "/film/454639/"],
  "15-m-no-home": ["m", "/", null, { home: false }],
  "17-m-privacy": ["m", "/privacy/"],
  "18-m-404": ["m", "/no-such-page/"],
  "19-d-week": ["d", "/"],
  "20-d-day": ["d", "/day/2026-10-06/"],
  "21-d-film": ["d", "/film/1275779/2026-10-05/"],
  "22-d-ticket": ["d", "/day/2026-10-04/", ticket("Book at")],
  "23-d-cinema": ["d", "/cinema/verdi/"],
  "24-d-cinemas": ["d", "/cinemas/"],
  "25-d-home": ["d", "/privacy/", openHome],
};

async function openHome(page) {
  await page.getByRole("navigation", { name: "Site" }).getByRole("button").click();
  await page.getByRole("dialog").waitFor();
  await page.waitForFunction(() => document.getAnimations().length === 0);
}

/** Open the first chip whose ticket matches: "Book at", "website" (no booking link) or "IMAX". */
function ticket(kind) {
  return async (page) => {
    if (await page.locator("details.seen").count()) await page.locator("details.seen summary").click();
    const chips = page.locator(".chip:not(.chip--more)");
    for (let i = 0; i < (await chips.count()); i++) {
      const chip = chips.nth(i);
      if (kind === "IMAX" ? !(await chip.textContent()).includes("IMAX") : !(await chip.isVisible())) continue;
      // An IMAX chip can sit past the phone's four; click it all the same.
      await chip.evaluate((el) => el.click());
      await page.getByRole("dialog").waitFor();
      const text = await page.getByRole("dialog").textContent();
      if (kind === "IMAX" || text.includes(kind)) {
        await page.waitForFunction(() => document.getAnimations().length === 0);
        return;
      }
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
    }
    throw new Error(`no ${kind} chip`);
  };
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const only = process.env.SHOTS_ONLY?.split(",");
for (const [name, [size, url, interact, opts = {}]] of Object.entries(SHOTS)) {
  if (only && !only.includes(name)) continue;
  const context = await browser.newContext({ viewport: SIZES[size], timezoneId: "Europe/Madrid" });
  await context.addInitScript(
    ({ home, seen, favourites }) => {
      if (home) localStorage.setItem("btw-home", JSON.stringify(home));
      localStorage.setItem("btw-seen", JSON.stringify(seen));
      localStorage.setItem("btw-fav", JSON.stringify(favourites));
    },
    { home: opts.home === false ? null : HOME, seen: SEEN, favourites: FAVOURITES },
  );
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  await page.goto(BASE + url);
  await page.evaluate(() => document.fonts.ready);
  // Let hydration settle before interacting.
  await page.waitForLoadState("networkidle");
  if (interact) await interact(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !!opts.fullPage });
  await context.close();
}
await browser.close();
console.log(`[shots] wrote ${OUT}`);
