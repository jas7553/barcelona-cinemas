// A date-shifted copy of the listings cache, so showtimes always land on upcoming days.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// So every film page shows a tagline, as most real ones do.
const FIXTURE_TAGLINE = "Believe the unbelievable.";

/** A showtime in the internal cache, which names its cinema rather than a theater id. */
type CacheShowtime = { date: string; time: string; cinema: string; premium_format?: string; booking_url?: string | null };
/** A showtime in the published listings.json. */
type FixtureShowtime = { date: string; time: string; theater_id: string; premium_format?: string; booking_url?: string };

/** The booking page injected on one showing, whatever the source cache had; bookableShowing() finds it. */
export const FIXTURE_BOOKING_URL = "https://tickets.example/fixture-booking";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";

/**
 * Build a temp CACHE_DIR holding a forward-shifted copy of cache/listings.json.
 * Throws if the source cache is missing.
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
  // The first film's last showing (earlier ones may have started) becomes IMAX
  // unless it has another format, and gets FIXTURE_BOOKING_URL; premiumShowing()
  // and bookableShowing() find it. Another showing at that cinema that day loses
  // its booking URL, so the day also has a site-only time. The booking URL is
  // what the refresh keeps when it merges a cinema's separately-titled IMAX
  // listing ("La Odisea: The IMAX Experience") into the film.
  const showtimes: CacheShowtime[] = data.movies[0].showtimes;
  const latest = showtimes.reduce((a, b) => (`${b.date}${b.time}` > `${a.date}${a.time}` ? b : a));
  latest.premium_format ??= "imax";
  latest.booking_url = FIXTURE_BOOKING_URL;
  const sameDay = (data.movies as { showtimes?: CacheShowtime[] }[])
    .flatMap((m) => m.showtimes ?? [])
    .find((s) => s !== latest && s.cinema === latest.cinema && s.date === latest.date);
  if (!sameDay) throw new Error("e2e: no other showing at the booked showing's cinema that day");
  delete sameDay.booking_url;
  data.fetched_at = new Date().toISOString();

  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "bmd-e2e-"));
  fs.writeFileSync(path.join(cacheDir, "listings.json"), JSON.stringify(data));
  return cacheDir;
}

/** The injected IMAX showing's film and date, for the dated film page that shows it. */
export function premiumShowing(): { id: string; date: string } {
  const published = path.join(ROOT, "static", "data", "listings.json");
  const data = JSON.parse(fs.readFileSync(published, "utf8"));
  for (const m of data.movies as { id: string; showtimes: FixtureShowtime[] }[]) {
    const s = m.showtimes.find((x) => x.premium_format === "imax");
    if (s) return { id: m.id, date: s.date };
  }
  throw new Error("e2e: published listings carry no injected IMAX showtime");
}

/** The injected showing that has a booking page: where and when to find its time on a cinema's day. */
export function bookableShowing(): { theaterId: string; date: string; time: string; filmId: string } {
  const published = path.join(ROOT, "static", "data", "listings.json");
  const data = JSON.parse(fs.readFileSync(published, "utf8"));
  for (const m of data.movies as { id: string; showtimes: FixtureShowtime[] }[]) {
    const s = m.showtimes.find((x) => x.booking_url === FIXTURE_BOOKING_URL);
    if (s) return { theaterId: s.theater_id, date: s.date, time: s.time, filmId: m.id };
  }
  throw new Error("e2e: published listings carry no injected booking URL");
}
