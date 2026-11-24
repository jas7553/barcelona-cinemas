/**
 * SensaCine's showtimes API: one JSON page per theatre per day, each film with its showtimes
 * grouped by version (`original`, `original_st`, `local`, `dubbed`, ...).
 */
import { z } from "zod";
import { addDays, madridWallClock } from "../../shared/madrid.ts";
import { getOk } from "../http.ts";
import {
  ADMIT_ONE_ENGLISH,
  normalizePremiumFormat,
  normalizeSubtitleLang,
  scrapedFilm,
} from "../normalize.ts";
import { reportPartialFailure } from "../errors.ts";
import { reconcile } from "../reconcile.ts";
import type { AudioLang, Provider, ScrapedFilm, ScrapedShowing } from "../types.ts";
import { buildShowing, mapPool } from "./support.ts";

const SENSACINE = "sensacine";

const BASE_URL = "https://www.sensacine.com";
const TIMEOUT_MS = 15_000;

/**
 * One page per cinema per day, over a hundred in all. A few at a time: enough to stop one slow page
 * holding up the rest, few enough to stay a polite client.
 */
const PAGE_WORKERS = 4;

/** Registry key to SensaCine theatre id. Cinemas not listed there have no entry. */
export const SENSACINE_IDS: Readonly<Record<string, string>> = {
  CinDiag: "E0381",
  CinDigMar: "E0382",
  SOM: "E0388",
  Malda: "E0682",
  Verdi: "E0608",
  VP: "E0610",
  Glòries: "E0442",
  Aribau: "E0091",
  Arenas: "E0764",
  Balmes: "E0808",
  Bosque: "E0136",
  Sarrià: "E0447",
  Girona: "E0747",
  RenFlo: "E0581",
  EspaiTexas: "E0873",
  Zumzeig: "E0850",
  Phenomena: "E0544",
};

/** Admit One theatre codes for the Mooby cinemas, whose "default" ticketing URL is a template. */
export const ADMIT_ONE_THEATRES: Readonly<Record<string, string>> = {
  Balmes: "BAL-BALMES",
  Aribau: "BAL-ARIBAU",
  Bosque: "BAL-BOSQUE",
  Sarrià: "BAL-SARRIA",
  Glòries: "BAL-GLORIAS",
  Arenas: "BAL-ARENAS",
};

/** The legacy site's window: today and the six days after. */
export const LEGACY_DAYS_AHEAD = 7;

/** The only version key the legacy site read. */
const LEGACY_VERSION = "original";

const SUBTITLE_TAG_PREFIX = "Localization.Subtitle.";
const FORMAT_TAG_PREFIX = "Format.Projection.";

const optionalText = z.string().nullish().catch(undefined);

const Ticketing = z.looseObject({
  provider: z.unknown(),
  urls: z.array(z.unknown()).nullish().catch(undefined),
});

const Showtime = z.looseObject({
  startsAt: optionalText,
  tags: z.array(z.unknown()).nullish().catch(undefined),
  data: z
    .looseObject({ ticketing: z.array(z.unknown()).nullish().catch(undefined) })
    .nullish()
    .catch(undefined),
});

const Entry = z.looseObject({
  movie: z
    .looseObject({
      title: optionalText,
      languages: z.array(z.unknown()).nullish().catch(undefined),
    })
    .nullish()
    .catch(undefined),
  showtimes: z.record(z.string(), z.unknown()).nullish().catch(undefined),
});

const Page = z.looseObject({ results: z.array(z.unknown()).nullish().catch(undefined) });

/** `YYYY-MM-DD` for each of `days` days from Madrid's today at `now`. */
export function fetchDates(now: Date, days: number): string[] {
  const today = madridWallClock(now).date;
  return Array.from({ length: days }, (_, i) => addDays(today, i));
}

/** Fills an Admit One template's `language` and `theatre`; `undefined` if a `%s` is left. */
function fillPlaceholders(url: string, theatre: string | undefined): string | undefined {
  const filled =
    theatre === undefined
      ? url
      : url
          .replace("language=%s", () => `language=${ADMIT_ONE_ENGLISH}`)
          .replace("theatre=%s", () => `theatre=${theatre}`);
  return filled.includes("%s") ? undefined : filled;
}

/**
 * The most direct booking URL among a showtime's ticketing entries: the `default` provider's (the
 * cinema's own), else the first relay's. An entry whose template `theatre` can't complete is
 * skipped.
 */
export function bookingUrl(ticketing: readonly unknown[], theatre?: string): string | undefined {
  let relay: string | undefined;
  for (const raw of ticketing) {
    const entry = Ticketing.safeParse(raw);
    if (!entry.success || !entry.data.urls?.length) continue;
    const url = fillPlaceholders(String(entry.data.urls[0]).trim(), theatre);
    if (!url) continue;
    if (entry.data.provider === "default") return url;
    relay ??= url;
  }
  return relay;
}

function tagSuffix(tags: readonly string[], prefix: string): string | undefined {
  return tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
}

/** One theatre-day's films, every version, or `undefined` when the page can't be read. */
export function parsePage(body: unknown, cinema: string): ScrapedFilm[] | undefined {
  const page = Page.safeParse(body);
  if (!page.success) return undefined;
  const films: ScrapedFilm[] = [];
  for (const rawEntry of page.data.results ?? []) {
    const entry = Entry.safeParse(rawEntry);
    if (!entry.success) continue;
    const title = entry.data.movie?.title?.trim();
    if (!title) continue;

    const languages = (entry.data.movie?.languages ?? []).map(String);
    const audio_lang: AudioLang | undefined = languages.includes("ENGLISH")
      ? "en"
      : languages.length > 0
        ? "other"
        : undefined;

    const showings: ScrapedShowing[] = [];
    for (const [version, rawShowtimes] of Object.entries(entry.data.showtimes ?? {})) {
      const versionShowtimes = z.array(z.unknown()).safeParse(rawShowtimes);
      if (!versionShowtimes.success) continue;
      for (const rawShowtime of versionShowtimes.data) {
        const showtime = Showtime.safeParse(rawShowtime);
        if (!showtime.success) continue;
        const { startsAt } = showtime.data;
        const split = startsAt?.indexOf("T") ?? -1;
        if (!startsAt || split < 0) continue;
        const date = startsAt.slice(0, split);
        const rest = startsAt.slice(split + 1);
        const tags = (showtime.data.tags ?? []).map(String);
        const subtitles = tagSuffix(tags, SUBTITLE_TAG_PREFIX);
        const format = tagSuffix(tags, FORMAT_TAG_PREFIX);
        const showing = buildShowing({
          cinema,
          date,
          time: rest.slice(0, 5),
          audio_lang,
          subtitle_lang: subtitles === undefined ? undefined : normalizeSubtitleLang(subtitles),
          premium_format: format === undefined ? undefined : normalizePremiumFormat(format),
          booking_url: bookingUrl(showtime.data.data?.ticketing ?? [], ADMIT_ONE_THEATRES[cinema]),
          labels: { version, audio: languages.join(", "), subtitles, format },
        });
        if (showing !== undefined) showings.push(showing);
      }
    }
    if (showings.length > 0) films.push(scrapedFilm(title, undefined, showings));
  }
  return films;
}

/**
 * The legacy filter: only `original` showtimes, and only of films listed in English or in no
 * language at all. Drops films left with no showings.
 */
export function legacyEnglishOnly(films: readonly ScrapedFilm[]): ScrapedFilm[] {
  return films.flatMap((film) => {
    const showings = film.showings.filter(
      (showing) => showing.labels?.version === LEGACY_VERSION && showing.audio_lang !== "other",
    );
    return showings.length > 0 ? [{ ...film, showings }] : [];
  });
}

export interface SensacineOptions {
  /** Registry key to theatre id; narrowed in recordings. */
  ids?: Readonly<Record<string, string>>;
  /** How many days from today to ask for. */
  daysAhead?: number;
}

export function sensacineProvider({
  ids = SENSACINE_IDS,
  daysAhead = LEGACY_DAYS_AHEAD,
}: SensacineOptions = {}): Provider {
  return {
    name: SENSACINE,
    async fetch({ fetcher, now, registry, log }) {
      const dates = fetchDates(now, daysAhead);
      const missing = Object.keys(ids).filter((key) => !registry.has(key));
      if (missing.length > 0) {
        log.warn("sensacine_keys_not_in_registry", { provider: SENSACINE, keys: missing.sort() });
      }
      const pages = Object.entries(ids)
        .filter(([key]) => registry.has(key))
        .flatMap(([cinema, id]) => dates.map((date) => ({ cinema, id, date })));

      const results = await mapPool(pages, PAGE_WORKERS, async ({ cinema, id, date }) => {
        try {
          const response = await getOk(
            fetcher,
            `${BASE_URL}/_/showtimes/theater-${id}/d-${date}/`,
            {
              timeoutMs: TIMEOUT_MS,
            },
          );
          const films = parsePage(JSON.parse(response.text), cinema);
          if (films === undefined) throw new Error("not a showtimes page");
          return films;
        } catch (error) {
          log.warn("sensacine_page_failed", {
            provider: SENSACINE,
            cinema,
            date,
            error: String(error),
          });
          return undefined;
        }
      });

      reportPartialFailure(log, SENSACINE, "pages", {
        failed: results.filter((films) => films === undefined).length,
        total: pages.length,
      });
      return { films: reconcile(legacyEnglishOnly(results.flatMap((films) => films ?? []))) };
    },
  };
}
