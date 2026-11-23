import { MADRID_TZ } from "../shared/madrid.ts";

/** Madrid calendar day (YYYY-MM-DD) of `now`. */
export function madridDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MADRID_TZ }).format(now);
}
