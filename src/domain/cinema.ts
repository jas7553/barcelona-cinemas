// A cinema's programme (requirements 5.4) and the Cinemas index (5.5).

import type { ListFilm } from "../pageData";
import type { Theater } from "../types";
import { byPlace, compare, filmRows, type Clock, type FilmRow, type Ranking } from "./schedule";
import type { DateKey } from "./time";

const seenLast = (seen: ReadonlySet<string>, a: FilmRow, b: FilmRow) =>
  Number(seen.has(a.film.id)) - Number(seen.has(b.film.id));

/** The week view's rows: by showings here, most first; seen last (SEEN_SCRIPT mirrors this in CSS). */
export function cinemaWeekRows(
  films: ListFilm[],
  days: DateKey[],
  clock: Clock,
  rank: Ranking,
  seen: ReadonlySet<string>,
): FilmRow[] {
  return filmRows(films, days, clock, rank).sort(
    (a, b) =>
      seenLast(seen, a, b) || b.showings.length - a.showings.length || compare(a.film.title, b.film.title),
  );
}

/** The Day view's rows: by first showing left, with seen films last. */
export function cinemaDayRows(
  films: ListFilm[],
  date: DateKey,
  clock: Clock,
  rank: Ranking,
  seen: ReadonlySet<string>,
): FilmRow[] {
  return filmRows(films, [date], clock, rank).sort(
    (a, b) =>
      seenLast(seen, a, b) ||
      compare(a.showings[0].time, b.showings[0].time) ||
      compare(a.film.title, b.film.title),
  );
}

/** How many films a cinema still has on, from each one's last showing there ("YYYY-MM-DDTHH:MM"). */
export function filmsLeft(lastShowings: string[] | undefined, clock: Clock): number {
  const now = `${clock.today}T${clock.time}`;
  return (lastShowings ?? []).filter((at) => at >= now).length;
}

/** My cinemas first, then the nearest, then A–Z. ORDER_SCRIPT applies it before first paint. */
export function cinemaOrder(rank: Ranking) {
  const place = byPlace(rank);
  return (a: Theater, b: Theater): number => place(a.id, b.id) || compare(a.name, b.name) || compare(a.id, b.id);
}
