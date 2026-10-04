// The week as the list pages see it: which days are in the horizon, which are
// published, which showings are left, and how films and their showings sort.
// Everything time-relative takes a Clock read from the page's `now`.

import type { CalendarDay, ListFilm, Showing } from "../pageData";
import type { Theater } from "../types";
import { distanceKm } from "./distance";
import { formatDistance, plural, shortName } from "./format";
import type { LatLng } from "./prefs";
import { addDays, formatWeekday, formatWeekdayLong, madridDateKey, madridTime, type DateKey } from "./time";

/** Days in the timetable: today plus six (requirements 7.2). */
export const HORIZON_DAYS = 7;

/** Films with this many showings left or fewer need planning around (requirements 5.1). */
export const FEW_SHOWINGS = 3;

/** Madrid's date and wall-clock time at an instant. */
export interface Clock {
  today: DateKey;
  time: string;
}

export function clockAt(now: Date): Clock {
  return { today: madridDateKey(now), time: madridTime(now) };
}

export function horizon(today: DateKey): DateKey[] {
  return Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(today, i));
}

export function hasStarted(s: Pick<Showing, "date" | "time">, clock: Clock): boolean {
  return s.date < clock.today || (s.date === clock.today && s.time < clock.time);
}

/** "Today", "Tue" */
export function dayShort(date: DateKey, today: DateKey): string {
  return date === today ? "Today" : formatWeekday(date);
}

/** "Today", "Tuesday" */
export function dayTitle(date: DateKey, today: DateKey): string {
  return date === today ? "Today" : formatWeekdayLong(date);
}

/** "Today", "Tue 6" */
export function dayAndDate(date: DateKey, today: DateKey): string {
  return date === today ? "Today" : `${formatWeekday(date)} ${Number(date.slice(8))}`;
}

/**
 * The first day whose listings are mostly not out yet, or null. Cinemas publish
 * a few days ahead, and a handful of one-off previews land beyond that, so a day
 * counts as not out yet when fewer than half of the cinemas showing something
 * today have anything on it (requirements 11.1). It and every later day are.
 * With nothing on today to compare against, it's the day after the last
 * published date.
 */
export function notOutFrom(calendar: CalendarDay[], today: DateKey): DateKey | null {
  const byDate = new Map(calendar.map((d) => [d.date, d]));
  const base = byDate.get(today)?.cinemas ?? 0;
  if (base === 0) {
    const last = calendar.reduce<DateKey | null>((max, d) => (max && max > d.date ? max : d.date), null);
    return last ? addDays(last, 1) : null;
  }
  for (let date = addDays(today, 1); date <= addDays(today, HORIZON_DAYS); date = addDays(date, 1)) {
    if ((byDate.get(date)?.cinemas ?? 0) < base / 2) return date;
  }
  return null;
}

export type DayStatus = "on" | "nothing-left" | "not-out";

export function dayStatus(date: DateKey, calendar: CalendarDay[], clock: Clock, notOut: DateKey | null): DayStatus {
  if (notOut && date >= notOut) return "not-out";
  const day = calendar.find((d) => d.date === date);
  if (!day || date < clock.today) return "nothing-left";
  return date > clock.today || day.last >= clock.time ? "on" : "nothing-left";
}

/** How far each cinema is and whether it's a favourite: the tie-breaks between equal times. */
export interface Ranking {
  favourite: (theaterId: string) => boolean;
  km: (theaterId: string) => number | null;
}

export function ranking(theaters: Theater[], home: LatLng | null, favourites: ReadonlySet<string>): Ranking {
  const kms = new Map(theaters.map((t) => [t.id, distanceKm(home, t)]));
  return { favourite: (id) => favourites.has(id), km: (id) => kms.get(id) ?? null };
}

/** Soonest first; at the same time, favourites then the nearest. */
export function byStart(rank: Ranking) {
  return (a: Showing, b: Showing): number =>
    (a.date + a.time).localeCompare(b.date + b.time) ||
    Number(rank.favourite(b.theater_id)) - Number(rank.favourite(a.theater_id)) ||
    (rank.km(a.theater_id) ?? Infinity) - (rank.km(b.theater_id) ?? Infinity);
}

export interface FilmRow {
  film: ListFilm;
  /** Showings not yet started on the given days, soonest first. */
  showings: Showing[];
}

/** One row per film with showings left on `days`, in data order. */
export function filmRows(films: ListFilm[], days: DateKey[], clock: Clock, rank: Ranking): FilmRow[] {
  const inRange = new Set(days);
  const compare = byStart(rank);
  return films
    .map((film) => ({
      film,
      showings: film.showtimes.filter((s) => inRange.has(s.date) && !hasStarted(s, clock)).sort(compare),
    }))
    .filter((row) => row.showings.length > 0);
}

const bySize = (a: FilmRow, b: FilmRow) => b.showings.length - a.showings.length;

// Films tie on title, not on the Home or favourites ranking: those load after
// first paint, and rows that reorder then shift the page (requirements 11.8).
const bySoonest = (a: FilmRow, b: FilmRow) =>
  `${a.showings[0].date}${a.showings[0].time}`.localeCompare(`${b.showings[0].date}${b.showings[0].time}`) ||
  a.film.title.localeCompare(b.film.title);

/** This week's sections (requirements 5.1). Seen films keep the size order. */
export function weekSections(rows: FilmRow[], seen: ReadonlySet<string>) {
  const unseen = rows.filter((r) => !seen.has(r.film.id));
  return {
    few: unseen.filter((r) => r.showings.length <= FEW_SHOWINGS).sort(bySoonest),
    all: unseen.filter((r) => r.showings.length > FEW_SHOWINGS).sort(bySize),
    seen: rows.filter((r) => seen.has(r.film.id)).sort(bySize),
  };
}

/** A day's rows by first start time (requirements 5.2, 11.8). */
export function daySections(rows: FilmRow[], seen: ReadonlySet<string>) {
  const sorted = [...rows].sort(bySoonest);
  return { films: sorted.filter((r) => !seen.has(r.film.id)), seen: sorted.filter((r) => seen.has(r.film.id)) };
}

/**
 * The where-line under a This week row: "Tue 6, 18:30 · Glòries · 3.1 km" for a
 * single showing, else "N showings · M cinemas · nearest Verdi 250 m", naming
 * the cinemas when there are two or fewer.
 */
export function rowSummary(row: FilmRow, theaters: ReadonlyMap<string, Theater>, rank: Ranking, today: DateKey): string {
  const { showings } = row;
  const nearestFirst = [...new Set(showings.map((s) => s.theater_id))].sort(
    (a, b) => (rank.km(a) ?? Infinity) - (rank.km(b) ?? Infinity),
  );
  const name = (id: string) => {
    const theater = theaters.get(id);
    return theater ? shortName(theater) : id;
  };
  const nearestKm = rank.km(nearestFirst[0]);
  const imax = showings.some((s) => s.premium_format === "imax") ? " · IMAX" : "";

  if (showings.length === 1) {
    const [s] = showings;
    const where = nearestKm == null ? "" : ` · ${formatDistance(nearestKm)}`;
    return `${dayAndDate(s.date, today)}, ${s.time} · ${name(s.theater_id)}${where}${imax}`;
  }
  const named = nearestFirst.length <= 2;
  const cinemas = named ? nearestFirst.map(name).join(", ") : plural(nearestFirst.length, "cinema");
  let nearest = "";
  if (nearestKm != null) {
    nearest = nearestFirst.length === 1 ? ` · nearest ${formatDistance(nearestKm)}` : ` · nearest ${name(nearestFirst[0])} ${formatDistance(nearestKm)}`;
  }
  return `${plural(showings.length, "showing")} · ${cinemas}${nearest}${imax}`;
}
