// The film page's showings for a day, grouped by cinema (requirements 5.3).

import type { Showing } from "../pageData";
import { byPlace, compare, type Ranking } from "./schedule";
import type { DateKey } from "./time";

export interface CinemaShowings {
  theaterId: string;
  /** The day's showings here by time, started ones included: they're dimmed, not removed. */
  showings: Showing[];
}

/**
 * One group per cinema showing it on `date`: favourites first, then the
 * nearest, then the earliest. ORDER_SCRIPT applies it before first paint.
 */
export function byCinema(showings: Showing[], date: DateKey, rank: Ranking): CinemaShowings[] {
  const groups = new Map<string, Showing[]>();
  for (const s of showings.filter((s) => s.date === date).sort((a, b) => a.time.localeCompare(b.time))) {
    const list = groups.get(s.theater_id);
    if (list) list.push(s);
    else groups.set(s.theater_id, [s]);
  }
  const place = byPlace(rank);
  return [...groups]
    .map(([theaterId, list]) => ({ theaterId, showings: list }))
    .sort(
      (a, b) =>
        place(a.theaterId, b.theaterId) ||
        compare(a.showings[0].time, b.showings[0].time) ||
        compare(a.theaterId, b.theaterId),
    );
}
