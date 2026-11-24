/** Helpers every provider shares: source labels to codes, and the scraped film and showing. */
import { madridIso } from "../shared/madrid.ts";
import {
  PREMIUM_FORMATS,
  type AudioLang,
  type PremiumFormat,
  type ScrapedFilm,
  type ScrapedShowing,
  type SubtitleLang,
} from "./types.ts";

// Sources label languages in mixed Catalan, Spanish and English ("Anglès", "Español", "English").
// Substrings tolerate accents and the -s/-és variants without a locale table.
const ENGLISH = ["english", "ingl", "angl"];
const SPANISH = ["españ", "espan", "castell", "spanish"];
const CATALAN = ["català", "catal"];

function matches(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

/** `undefined` when the label is blank. */
export function normalizeAudioLang(raw: string): AudioLang | undefined {
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  return matches(value, ENGLISH) ? "en" : "other";
}

/** `undefined` when the label is blank or another language. */
export function normalizeSubtitleLang(raw: string): SubtitleLang | undefined {
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  if (matches(value, ENGLISH)) return "en";
  // A label naming both, e.g. "Català i castellà", counts as Catalan.
  if (matches(value, CATALAN)) return "ca";
  if (matches(value, SPANISH)) return "es";
  return undefined;
}

/**
 * The premium format a label names ("IMAX 3D", "Sala IMAX"), else `undefined`. The slug is the
 * needle: brand names are distinctive enough that a substring can't plausibly misfire.
 */
export function normalizePremiumFormat(raw: string): PremiumFormat | undefined {
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  return PREMIUM_FORMATS.find((slug) => value.includes(slug));
}

/**
 * A showing's `starts_at` from Madrid `YYYY-MM-DD` and `HH:MM`, or `undefined` for a malformed
 * value or a time the clocks skip.
 */
export function showingStart(date: string, time: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return undefined;
  try {
    return madridIso(date, time);
  } catch {
    return undefined;
  }
}

/**
 * Admit One's code for its English seat picker, as its own language switcher sets it; "en" or a
 * missing value falls back to the cinema's Catalan default.
 */
export const ADMIT_ONE_ENGLISH = "ENG";

/** A film with only what a provider knows; enrichment adds the rest. */
export function scrapedFilm(
  title: string,
  imdbId: string | undefined,
  showings: ScrapedShowing[],
): ScrapedFilm {
  return imdbId === undefined ? { title, showings } : { title, imdb_id: imdbId, showings };
}
