/** What the four providers share: their failure type, a bounded-concurrency map, showing assembly. */
import { showingStart } from "../normalize.ts";
import type { AudioLang, PremiumFormat, ScrapedShowing, SubtitleLang } from "../types.ts";

/** A source's page did not have the shape the provider reads. */
export class ProviderParseError extends Error {
  override readonly name = "ProviderParseError";
}

/** `fn` over `items`, at most `limit` at a time; results in the order of `items`. */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const pending = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of pending) results[index] = await fn(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface ShowingParts {
  cinema: string;
  /** Madrid `YYYY-MM-DD` and `HH:MM`. */
  date: string;
  time: string;
  audio_lang?: AudioLang | undefined;
  subtitle_lang?: SubtitleLang | undefined;
  premium_format?: PremiumFormat | undefined;
  booking_url?: string | undefined;
  /** The source's own words; blank ones are left out. */
  labels?: {
    version?: string | undefined;
    audio?: string | undefined;
    subtitles?: string | undefined;
    format?: string | undefined;
  };
}

/** `undefined` when the date and time are not a Madrid wall-clock time. */
export function buildShowing(parts: ShowingParts): ScrapedShowing | undefined {
  const starts_at = showingStart(parts.date, parts.time);
  if (starts_at === undefined) return undefined;
  const { version, audio, subtitles, format } = parts.labels ?? {};
  const labels = {
    ...(version && { version }),
    ...(audio && { audio }),
    ...(subtitles && { subtitles }),
    ...(format && { format }),
  };
  return {
    cinema: parts.cinema,
    starts_at,
    language: "vo",
    ...(parts.audio_lang !== undefined && { audio_lang: parts.audio_lang }),
    ...(parts.subtitle_lang !== undefined && { subtitle_lang: parts.subtitle_lang }),
    ...(parts.premium_format !== undefined && { premium_format: parts.premium_format }),
    ...(parts.booking_url !== undefined && { booking_url: parts.booking_url }),
    ...(Object.keys(labels).length > 0 && { labels }),
  };
}
