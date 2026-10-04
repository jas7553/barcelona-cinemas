// A cinema's programme (requirements 5.4) and the Cinemas index (5.5).

import type { ListFilm } from "../pageData";
import type { Theater } from "../types";
import { filmRows, type Clock, type FilmRow, type Ranking } from "./schedule";
import type { DateKey } from "./time";

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const seenLast = (seen: ReadonlySet<string>) => (a: FilmRow, b: FilmRow) =>
  Number(seen.has(a.film.id)) - Number(seen.has(b.film.id));

/**
 * The week view's rows: by showings here, most first, with seen films last.
 * Seen films stay in the list, so the pre-paint script can put them last with
 * CSS alone; ties go on title, never on prefs.
 */
export function cinemaWeekRows(
  films: ListFilm[],
  days: DateKey[],
  clock: Clock,
  rank: Ranking,
  seen: ReadonlySet<string>,
): FilmRow[] {
  return filmRows(films, days, clock, rank).sort(
    (a, b) =>
      seenLast(seen)(a, b) || b.showings.length - a.showings.length || compare(a.film.title, b.film.title),
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
      seenLast(seen)(a, b) ||
      compare(a.showings[0].time, b.showings[0].time) ||
      compare(a.film.title, b.film.title),
  );
}

/** How many films a cinema still has on, from each one's last showing there ("YYYY-MM-DDTHH:MM"). */
export function filmsLeft(lastShowings: string[] | undefined, clock: Clock): number {
  const now = `${clock.today}T${clock.time}`;
  return (lastShowings ?? []).filter((at) => at >= now).length;
}

/**
 * My cinemas first, then the nearest, then A–Z. ORDER_SCRIPT in
 * scripts/template.mjs applies the same order before first paint.
 */
export function cinemaOrder(rank: Ranking) {
  return (a: Theater, b: Theater): number =>
    Number(rank.favourite(b.id)) - Number(rank.favourite(a.id)) ||
    (rank.km(a.id) ?? Infinity) - (rank.km(b.id) ?? Infinity) ||
    compare(a.name, b.name) ||
    compare(a.id, b.id);
}
