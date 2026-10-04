// The film page's showtimes panel: which day it opens on, and that day's
// showings grouped by cinema (requirements 5.3).

import type { Showing } from "../pageData";
import { hasStarted, type Clock, type Ranking } from "./schedule";
import type { DateKey } from "./time";

/** The first of `days` with a showing still to start, or null when there's none left. */
export function firstDayLeft(showings: Showing[], days: DateKey[], clock: Clock): DateKey | null {
  return days.find((date) => showings.some((s) => s.date === date && !hasStarted(s, clock))) ?? null;
}

export interface CinemaShowings {
  theaterId: string;
  /** The day's showings here by time, started ones included: they're dimmed, not removed. */
  showings: Showing[];
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * One group per cinema showing it on `date`: favourites first, then the
 * nearest, then the earliest. ORDER_SCRIPT in scripts/template.mjs applies the
 * same order before first paint, so keep the two in step.
 */
export function byCinema(showings: Showing[], date: DateKey, rank: Ranking): CinemaShowings[] {
  const groups = new Map<string, Showing[]>();
  for (const s of showings.filter((s) => s.date === date).sort((a, b) => a.time.localeCompare(b.time))) {
    groups.set(s.theater_id, [...(groups.get(s.theater_id) ?? []), s]);
  }
  return [...groups]
    .map(([theaterId, list]) => ({ theaterId, showings: list }))
    .sort(
      (a, b) =>
        Number(rank.favourite(b.theaterId)) - Number(rank.favourite(a.theaterId)) ||
        (rank.km(a.theaterId) ?? Infinity) - (rank.km(b.theaterId) ?? Infinity) ||
        compare(a.showings[0].time, b.showings[0].time) ||
        compare(a.theaterId, b.theaterId),
    );
}
