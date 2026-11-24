/**
 * The film-catalog site: a page of film cards, each linking to a detail page that groups showtime
 * chips by cinema. Every showing it lists is in English, so there is no legacy filter to split off.
 */
import { load } from "cheerio";
import { madridWallClock } from "../../shared/madrid.ts";
import { getOk } from "../http.ts";
import { normalizePremiumFormat, scrapedFilm } from "../normalize.ts";
import { buildCinemaAliasLookup, normalizeAlias } from "../registry.ts";
import type { Provider, ScrapedFilm, ScrapedShowing } from "../types.ts";
import { buildShowing, ProviderParseError } from "./support.ts";

const ENGLISH_CINEMA_BCN = "english_cinema_bcn";

const TIMEOUT_MS = 15_000;

const MONTHS: ReadonlyMap<string, number> = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
    (name, index) => [name, index + 1],
  ),
);

/** A listing more than this many days in the past is next year's. */
const ROLLOVER_DAYS = 8;

function validDate(year: number, month: number, day: number): Date | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? date : undefined;
}

const iso = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * A chip's `data-showtime-label`, e.g. "Sun 13 Sept 20:45", as Madrid `date` and `time`. The year
 * comes from `today` (a Madrid `YYYY-MM-DD`), rolling over to next year for a date well past. The
 * month is matched on its first three letters: the site spells September "Sept". `undefined` for
 * anything else, including a day the month lacks.
 */
export function parseShowtimeLabel(
  label: string,
  today: string,
): { date: string; time: string } | undefined {
  const parts = label.split(/\s+/).filter(Boolean);
  const [, dayText, monthText, time] = parts;
  if (parts.length !== 4 || dayText === undefined || monthText === undefined || time === undefined)
    return undefined;
  const month = MONTHS.get(monthText.slice(0, 3));
  if (month === undefined || !/^\d+$/.test(dayText)) return undefined;
  const day = Number(dayText);
  const year = Number(today.slice(0, 4));
  const todayDate = new Date(`${today}T00:00:00Z`);
  const candidate = validDate(year, month, day);
  if (candidate === undefined) return undefined;
  const daysPast = (todayDate.getTime() - candidate.getTime()) / 86_400_000;
  const resolved = daysPast > ROLLOVER_DAYS ? validDate(year + 1, month, day) : candidate;
  return resolved === undefined ? undefined : { date: iso(resolved), time };
}

export interface EnglishCinemaBcnOptions {
  /** The catalog page; kept out of the repo. */
  feedUrl: string | undefined;
}

export function englishCinemaBcnProvider(options: EnglishCinemaBcnOptions): Provider {
  return {
    name: ENGLISH_CINEMA_BCN,
    async fetch({ fetcher, now, registry, log }) {
      if (options.feedUrl === undefined) throw new Error("LISTINGS_FEED_URL is not set");
      const feed = await getOk(fetcher, options.feedUrl, { timeoutMs: TIMEOUT_MS });
      const $feed = load(feed.text);
      const cards = $feed("a.film-card").toArray();
      if (cards.length === 0) {
        throw new ProviderParseError("Could not find film listing cards on page");
      }

      const today = madridWallClock(now).date;
      const aliasLookup = buildCinemaAliasLookup(registry, ENGLISH_CINEMA_BCN);
      const seenNames = new Set<string>();
      const films: ScrapedFilm[] = [];

      for (const card of cards) {
        const title = $feed(card).attr("data-title")?.trim() ?? "";
        const href = $feed(card).attr("href");
        if (!title || !href) continue;

        const page = await getOk(fetcher, new URL(href, feed.url).href, { timeoutMs: TIMEOUT_MS });
        const $ = load(page.text);
        const showings: ScrapedShowing[] = [];

        for (const block of $("div.cinema-block").toArray()) {
          const name = $(block).find("h3.cinema-block-name").first();
          if (name.length === 0) continue;
          const cinemaName = name.text().trim();
          seenNames.add(cinemaName);
          const cinema = aliasLookup.get(normalizeAlias(cinemaName));

          for (const chip of $(block).find("a.showtime-chip").toArray()) {
            const when = parseShowtimeLabel($(chip).attr("data-showtime-label") ?? "", today);
            if (when === undefined || cinema === undefined) continue;
            const tags = $(chip)
              .find("span.showtime-tag")
              .toArray()
              .map((tag) => $(tag).text());
            const premiumTag = tags.find((tag) => normalizePremiumFormat(tag) !== undefined);
            const showing = buildShowing({
              cinema,
              ...when,
              premium_format:
                premiumTag === undefined ? undefined : normalizePremiumFormat(premiumTag),
              labels: { format: premiumTag?.trim() },
            });
            if (showing !== undefined) showings.push(showing);
          }
        }
        if (showings.length > 0) films.push(scrapedFilm(title, undefined, showings));
      }

      const unrecognized = [...seenNames].filter((name) => !aliasLookup.has(normalizeAlias(name)));
      if (unrecognized.length > 0) {
        log.warn("unrecognized_cinema_names", {
          provider: ENGLISH_CINEMA_BCN,
          names: unrecognized.sort(),
        });
      }
      return { films, entry: feed };
    },
  };
}
