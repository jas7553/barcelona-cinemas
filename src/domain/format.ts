import type { Showtime, Theater } from "../types";

// Chain prefixes dropped from cinema names in chips and summaries (guidelines §7).
const CHAIN_PREFIX = /^(?:Cines|Cine|Cinema|Cinemes|Cinesa|Mooby|Yelmo)\s+/;

/** "Verdi" for "Cines Verdi". Published data carries it; older data falls back to the rule. */
export function shortName(theater: Pick<Theater, "name" | "short_name">): string {
  return theater.short_name || theater.name.replace(CHAIN_PREFIX, "");
}

/** "250 m" (to the nearest 50 m) under 1 km, then "1.5 km". */
export function formatDistance(km: number): string {
  const metres = Math.max(50, Math.round(km * 20) * 50);
  return metres < 1000 ? `${metres} m` : `${km.toFixed(1)} km`;
}

/** "2h 05m" */
export function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, "0");
  return h ? `${h}h ${m}m` : `${minutes}m`;
}

/** "1 showing", "3 showings" */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "Fri", "Fri and Sat", "Thu, Fri and Sat" */
export function joinAnd(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const SUBTITLE_LABEL = { en: "English subs", es: "Spanish subs", ca: "Catalan subs" } as const;

/**
 * The subtitle version tag. English audio is the site's norm and unknown audio
 * can't be vouched for, so only non-English audio gets one (CONTEXT.md).
 */
export function subtitleLabel(s: Pick<Showtime, "audio_lang" | "subtitle_lang">): string | null {
  if (s.audio_lang !== "other" || !s.subtitle_lang) return null;
  return SUBTITLE_LABEL[s.subtitle_lang];
}

// TMDb serves fixed widths; list and ticket posters are at most 56 CSS px wide.
const POSTER_SIZE = /\/t\/p\/w\d+\//;

/** A TMDb poster URL resized for a small slot. */
export function smallPoster(url: string): string {
  return url.replace(POSTER_SIZE, "/t/p/w154/");
}
