import type { Showtime, Theater } from "../types";
import { formatDayFull, type DateKey } from "./time";

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

const SUBTITLE_LABEL = { en: "English subtitles", es: "Spanish subtitles", ca: "Catalan subtitles" } as const;

/**
 * The subtitle version tag. English audio is the site's norm and unknown audio
 * can't be vouched for, so only non-English audio gets one (CONTEXT.md).
 */
export function subtitleLabel(s: Pick<Showtime, "audio_lang" | "subtitle_lang">): string | null {
  if (s.audio_lang !== "other" || !s.subtitle_lang) return null;
  return SUBTITLE_LABEL[s.subtitle_lang];
}

// TMDb serves fixed widths. List and ticket posters are at most 56 CSS px
// wide, the film page's at most 180.
const POSTER_SIZE = /\/t\/p\/(?:w\d+|original)\//;

/** A TMDb poster URL resized for a small slot. */
export function smallPoster(url: string): string {
  return url.replace(POSTER_SIZE, "/t/p/w154/");
}

/** A `srcset` for the small slot, so a 1x screen takes w92 rather than w154. */
export function smallPosterSrcset(url: string): string {
  return `${url.replace(POSTER_SIZE, "/t/p/w92/")} 92w, ${smallPoster(url)} 154w`;
}

interface ShowingNameInput {
  time: string;
  date: DateKey;
  cinema: string;
  /** No booking page of its own: the time leads to the cinema's site. */
  siteOnly: boolean;
  /** Leads the name where the page doesn't already say which film. */
  title?: string;
  /** Tags the chip draws, such as "IMAX". */
  tags?: (string | null)[];
}

/** "21:00, Verdi, Friday 24 October, book tickets": a showtime chip's accessible name. */
export function showingName({ time, date, cinema, siteOnly, title, tags = [] }: ShowingNameInput): string {
  return [title, time, ...tags, cinema, formatDayFull(date), siteOnly ? "no booking page, cinema site" : "book tickets"]
    .filter(Boolean)
    .join(", ");
}

/** A TMDb poster URL resized for the film page. */
export function largePoster(url: string): string {
  return url.replace(POSTER_SIZE, "/t/p/w342/");
}
