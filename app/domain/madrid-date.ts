import { addDays, madridWallClock } from "../shared/madrid.ts";

/** Madrid calendar day (YYYY-MM-DD) of `now`. */
export function madridDay(now: Date): string {
  return madridWallClock(now).date;
}

/**
 * The cinema day (YYYY-MM-DD) an instant belongs to. It ends at 06:00 Madrid, so a 00:30 showing
 * is the previous day's, and so is the site's "today" until 06:00.
 */
export function cinemaDay(instant: Date): string {
  const { date, time } = madridWallClock(instant);
  return time < "06:00" ? addDays(date, -1) : date;
}
