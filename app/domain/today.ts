import { cinemaDay } from "../shared/madrid.ts";

/** The site's "today": the cinema day of `now`, so it turns over at 06:00 Madrid. */
export function today(now: Date): string {
  return cinemaDay(now);
}
