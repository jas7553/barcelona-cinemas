/**
 * Reconciliation: one film per identity. Runs on the providers' films before enrichment and on the
 * enriched films after it, when TMDb's imdb ids join copies listed under different titles.
 */
import type { Logger } from "./log.ts";
import type { ScrapedFilm, ScrapedShowing } from "./types.ts";

// Python's `string.whitespace` and `string.punctuation` (ASCII both), and curly quotes.
const EDGE_CHARS = /^[\t-\r !-/:-@[-`{-~“”‘’]+|[\t-\r !-/:-@[-`{-~“”‘’]+$/g;
// Python's `str.split()` whitespace (but the information separators): `\s` differs outside ASCII.
const WHITESPACE = /[\t-\r \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;

/** Python's `str.casefold` closely enough for titles: "ß" folds to "ss", final sigma to sigma. */
function caseFold(value: string): string {
  return value.toUpperCase().toLowerCase().replaceAll("ς", "σ");
}

/** Case-folded, whitespace collapsed, edge punctuation and quotes stripped. */
export function normalizeTitle(title: string): string {
  return caseFold(title.replace(EDGE_CHARS, ""))
    .split(WHITESPACE)
    .filter((word) => word !== "")
    .join(" ");
}

/** The same film: equal imdb ids when both have one, otherwise equal normalized titles. */
export function sameFilm(left: ScrapedFilm, right: ScrapedFilm): boolean {
  if (left.imdb_id && right.imdb_id) return left.imdb_id === right.imdb_id;
  return normalizeTitle(left.title) === normalizeTitle(right.title);
}

export type ReconcileStage = "collection" | "post_enrichment";

// Caps one log line however badly a run over-merges.
const MAX_LOGGED_MERGES = 25;

/**
 * Collapses copies of the same film into one, in first-seen order: showings merged by
 * `dedupShowings` and sorted, the longest title kept, every other field the first copy's that has
 * it. A merged film answers to the title of every copy folded into it, so a copy without an imdb
 * id finds its film whatever order the copies arrive in.
 *
 * With `summary`, logs `reconcile_summary`, naming the merges across different titles: those are
 * an imdb id match doing its job or an over-merge hiding a film.
 */
export function reconcile<F extends ScrapedFilm>(
  films: readonly F[],
  summary?: { stage: ReconcileStage; log: Logger },
): F[] {
  const merged: F[] = [];
  const titles: Set<string>[] = [];
  const crossTitleMerges: string[] = [];
  for (const film of films) {
    const title = normalizeTitle(film.title);
    const index = merged.findIndex((existing, i) =>
      existing.imdb_id && film.imdb_id
        ? existing.imdb_id === film.imdb_id
        : titles[i]?.has(title) === true,
    );
    const existing = merged[index];
    if (existing === undefined) {
      merged.push(film);
      titles.push(new Set([title]));
      continue;
    }
    if (normalizeTitle(existing.title) !== title) {
      crossTitleMerges.push(`${existing.title} ← ${film.title}`);
    }
    merged[index] = mergePair(existing, film);
    titles[index]?.add(title);
  }
  if (summary) {
    const showingsIn = countShowings(films);
    const showingsOut = countShowings(merged);
    summary.log.info("reconcile_summary", {
      stage: summary.stage,
      movies_in: films.length,
      movies_out: merged.length,
      movies_merged: films.length - merged.length,
      showtimes_in: showingsIn,
      showtimes_out: showingsOut,
      showtimes_deduped: showingsIn - showingsOut,
      cross_title_merge_count: crossTitleMerges.length,
      cross_title_merges: crossTitleMerges.slice(0, MAX_LOGGED_MERGES),
    });
  }
  return merged;
}

function countShowings(films: readonly ScrapedFilm[]): number {
  return films.reduce((sum, film) => sum + film.showings.length, 0);
}

function longerTitle(left: string, right: string): string {
  if (left.length !== right.length) return left.length > right.length ? left : right;
  return caseFold(right) < caseFold(left) ? right : left;
}

function mergePair<F extends ScrapedFilm>(left: F, right: F): F {
  const showings = dedupShowings([...left.showings, ...right.showings], showingKey).sort(
    compareShowings,
  );
  // Optional fields are absent rather than undefined, so the spread keeps the first present value.
  return { ...right, ...left, title: longerTitle(left.title, right.title), showings };
}

/** Start, cinema and canonical language: every field a duplicate must share. */
function showingKey(showing: ScrapedShowing): string {
  return `${showing.starts_at}|${showing.cinema}|${showing.language}`;
}

function compareShowings(a: ScrapedShowing, b: ScrapedShowing): number {
  const left = [a.starts_at, a.cinema, a.language];
  const right = [b.starts_at, b.cinema, b.language];
  for (const [i, value] of left.entries()) {
    const other = right[i] ?? "";
    if (value !== other) return value < other ? -1 : 1;
  }
  return 0;
}

// The fields a duplicate copy may or may not carry; each provider knows a different subset.
const INFO_FIELDS = [
  "language",
  "booking_url",
  "audio_lang",
  "subtitle_lang",
  "premium_format",
] as const;

function mergeShowingInfo(base: ScrapedShowing, other: ScrapedShowing): ScrapedShowing {
  let merged = base;
  for (const field of INFO_FIELDS) {
    const value = other[field];
    if (value && !merged[field]) merged = { ...merged, [field]: value };
  }
  if (other.labels) merged = { ...merged, labels: { ...other.labels, ...merged.labels } };
  return merged;
}

/**
 * Collapses showings with the same `key`, in first-seen order. The first copy supplies everything
 * but the info fields it lacks, which any later copy fills, so no booking link or format is lost
 * to provider order.
 */
export function dedupShowings(
  showings: readonly ScrapedShowing[],
  key: (showing: ScrapedShowing) => string,
): ScrapedShowing[] {
  const deduped = new Map<string, ScrapedShowing>();
  for (const showing of showings) {
    const k = key(showing);
    const existing = deduped.get(k);
    deduped.set(k, existing ? mergeShowingInfo(existing, showing) : showing);
  }
  return [...deduped.values()];
}
