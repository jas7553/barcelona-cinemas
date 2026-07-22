// Shared e2e fixture: a date-shifted copy of the local listings cache so that
// showtimes always land on upcoming days regardless of when the suite runs.
// Used by both playwright.config.ts (to point the Flask app at it) and the spec
// (to assert on the injected tagline).

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

export const FIXTURE_TAGLINE = "Believe the unbelievable.";

type FixtureShowtime = { date: string; time: string; premium_format?: string };

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";

/**
 * Build a temp CACHE_DIR holding a forward-shifted copy of cache/listings.json.
 * Returns the directory path. Throws if the source cache is missing.
 */
export function buildFixtureCache(): string {
  // Prefer the live local cache (freshest); fall back to the committed snapshot
  // so CI, which can't reach TMDb, still has data. Date-shifting below makes the
  // snapshot's age irrelevant.
  const livePath = path.join(ROOT, "cache", "listings.json");
  const snapshotPath = path.join(ROOT, "e2e", "fixtures", "listings.json");
  const cachePath = fs.existsSync(livePath) ? livePath : snapshotPath;
  if (!fs.existsSync(cachePath)) {
    throw new Error("e2e: no listings cache — run `npm run refresh-cache` or restore e2e/fixtures/listings.json");
  }

  const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const allDates: string[] = data.movies.flatMap((m: { showtimes?: { date: string }[] }) =>
    (m.showtimes ?? []).map((s) => s.date),
  );
  const minDate = new Date(`${allDates.sort()[0]}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deltaDays = Math.round((today.getTime() - minDate.getTime()) / 86400000);

  for (const m of data.movies) {
    for (const s of m.showtimes ?? []) {
      const d = new Date(`${s.date}T00:00:00`);
      d.setDate(d.getDate() + deltaDays);
      s.date = d.toISOString().slice(0, 10);
    }
    m.tagline ??= FIXTURE_TAGLINE;
  }
  // Real English-VO IMAX volume is event-driven (one film, one week), so the
  // committed snapshot usually carries none — inject one so the chip's coverage
  // is deterministic. Mark the last showtime of the first film: the date-shift
  // lands the earliest showtimes on today, which the app filters out once their
  // time has passed. `premiumFormatFilmId` finds it back for the spec.
  const showtimes: FixtureShowtime[] = data.movies[0].showtimes;
  const latest = showtimes.reduce((a, b) => (`${b.date}${b.time}` > `${a.date}${a.time}` ? b : a));
  latest.premium_format ??= "imax";
  data.fetched_at = new Date().toISOString();

  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "bmd-e2e-"));
  fs.writeFileSync(path.join(cacheDir, "listings.json"), JSON.stringify(data));
  return cacheDir;
}

/**
 * Id of the film `buildFixtureCache` marked premium, read back from the
 * published listings the dev SSG server renders from. Cross-process: the
 * config builds the cache, the spec runs elsewhere, so the id can't be a
 * module constant.
 */
export function premiumFormatFilmId(): string {
  const published = path.join(ROOT, "static", "data", "listings.json");
  const data = JSON.parse(fs.readFileSync(published, "utf8"));
  const film = data.movies.find((m: { showtimes: FixtureShowtime[] }) =>
    m.showtimes.some((s) => s.premium_format === "imax"),
  );
  if (!film) throw new Error("e2e: published listings carry no injected IMAX showtime");
  return film.id;
}
