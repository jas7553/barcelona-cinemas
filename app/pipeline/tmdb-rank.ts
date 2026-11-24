/**
 * Which TMDb search result a listed title is. Precision first: a wrong match is worse than none,
 * since an unmatched film is still listed under its own title.
 */
import { addDays } from "../shared/madrid.ts";
import { normalizeTitle } from "./reconcile.ts";
import type { Detail, SearchResult } from "./tmdb-schema.ts";

const TV_MOVIE_GENRE = 10770;
// The primary release may be a festival premiere well before the Spanish one; ahead admits previews.
const RECENT_RELEASE_DAYS_BEFORE = 730;
const FIRST_RUN_DAYS_BEFORE = 365;
const RELEASE_DAYS_AHEAD = 90;
// TMDb release types: premiere, limited theatrical, theatrical.
const CINEMA_RELEASE_TYPES: ReadonlySet<number> = new Set([1, 2, 3]);
// The Academy's cut-off for a short.
const MIN_FEATURE_RUNTIME = 40;
const MAX_FIRST_RUN_PROBES = 2;
export const MAX_DETAIL_PROBES = 3;

/** `YYYY-MM-DD` from the start of a TMDb date, or `undefined`. */
function releaseDay(value: string | undefined): string | undefined {
  const day = value?.slice(0, 10);
  if (day === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  // Rejects impossible dates like 2026-02-30, which `Date` would roll over.
  return new Date(`${day}T00:00:00Z`).toISOString().startsWith(day) ? day : undefined;
}

function releasedWithin(value: string | undefined, today: string, daysBefore: number): boolean {
  const day = releaseDay(value);
  return (
    day !== undefined &&
    addDays(today, -daysBefore) <= day &&
    day <= addDays(today, RELEASE_DAYS_AHEAD)
  );
}

function films(results: readonly SearchResult[]): SearchResult[] {
  return results.filter((result) => !result.genre_ids.includes(TV_MOVIE_GENRE));
}

/** The films (TV movies never count) whose title is `title`, normalized. */
export function exactMatches(title: string, results: readonly SearchResult[]): SearchResult[] {
  const key = normalizeTitle(title);
  return films(results).filter((result) => normalizeTitle(result.title) === key);
}

/**
 * The search results that may be `title`: `firstRun`, recent releases tried first that win only in
 * their Spanish first run, then `ordered`, every candidate in turn. `today` is Madrid's date.
 *
 * A title match is exact; with none, TMDb's top film stands in, as that is how a Spanish-titled
 * listing finds its film. Among same-title films, those released within a year of `year` come
 * first when the source gives one. Otherwise a new release is the usual reason for a title clash,
 * so recent ones are tried first; failing that TMDb's popularity order stands, which keeps a
 * repertory classic ahead of its obscure namesakes.
 */
export function rankCandidates(
  title: string,
  results: readonly SearchResult[],
  { year, today }: { year: number | undefined; today: string },
): { firstRun: SearchResult[]; ordered: SearchResult[] } {
  const exact = exactMatches(title, results);
  if (exact.length === 0) return { firstRun: [], ordered: films(results).slice(0, 1) };
  if (year !== undefined) {
    const nearYear = (result: SearchResult): boolean => {
      const day = releaseDay(result.release_date);
      return day !== undefined && Math.abs(Number(day.slice(0, 4)) - year) <= 1;
    };
    return {
      firstRun: [],
      ordered: [...exact.filter(nearYear), ...exact.filter((result) => !nearYear(result))],
    };
  }
  const recent = exact.filter((result) =>
    releasedWithin(result.release_date, today, RECENT_RELEASE_DAYS_BEFORE),
  );
  return { firstRun: recent.slice(0, MAX_FIRST_RUN_PROBES), ordered: exact };
}

/** A Spanish cinema release within the last year, or due soon. */
export function inSpanishFirstRun(detail: Detail, today: string): boolean {
  return detail.release_dates.results.some(
    (country) =>
      country.iso_3166_1 === "ES" &&
      country.release_dates.some(
        (release) =>
          release.type !== undefined &&
          CINEMA_RELEASE_TYPES.has(release.type) &&
          releasedWithin(release.release_date, today, FIRST_RUN_DAYS_BEFORE),
      ),
  );
}

/** Not a short. TMDb gives 0 for an unknown runtime, common before release. */
export function isFeatureLength(detail: Detail): boolean {
  const { runtime } = detail;
  return runtime === undefined || runtime === 0 || runtime >= MIN_FEATURE_RUNTIME;
}
