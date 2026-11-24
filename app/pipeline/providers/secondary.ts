/**
 * The shop-feed site: one page whose `window.shops` script holds every cinema's events and
 * performances, with a ticket-URL template per cinema.
 */
import { z } from "zod";
import { NotConfiguredError } from "../errors.ts";
import { getOk } from "../http.ts";
import type { Logger } from "../log.ts";
import {
  ADMIT_ONE_ENGLISH,
  normalizeAudioLang,
  normalizeSubtitleLang,
  scrapedFilm,
} from "../normalize.ts";
import { reconcile } from "../reconcile.ts";
import { buildCinemaAliasLookup, normalizeAlias, type CinemaRegistry } from "../registry.ts";
import type { Provider, ScrapedFilm, ScrapedShowing } from "../types.ts";
import { buildShowing, ProviderParseError } from "./support.ts";

const SECONDARY = "secondary";

const TIMEOUT_MS = 20_000;

const WINDOW_SHOPS = /window\.shops\s*=\s*(\{.*?\});/s;

const text = z.string().optional().catch(undefined);

const Shop = z.looseObject({
  label: text,
  name: text,
  slug: text,
  code: text,
  shop_url: text,
  events: z.array(z.unknown()).optional().catch(undefined),
});

const Event = z.looseObject({
  name: text,
  imdbid: text,
  language: text,
  subtitles_lang: text,
  performances: z.array(z.unknown()).optional().catch(undefined),
});

const Performance = z.looseObject({
  schedule_date: text,
  time: text,
  performance_code: text,
});

/** The shops by id; throws `ProviderParseError` when the page has no readable payload. */
export function extractShops(html: string): Record<string, unknown> {
  const match = WINDOW_SHOPS.exec(html);
  if (match?.[1] === undefined) {
    throw new ProviderParseError("Could not find window.shops payload on listings page");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(match[1]);
  } catch (error) {
    throw new ProviderParseError("Could not decode shops payload", { cause: error });
  }
  const shops = z.record(z.string(), z.unknown()).safeParse(payload);
  if (!shops.success) throw new ProviderParseError("Shops payload was not an object");
  return shops.data;
}

/**
 * A shop's ticket template and theatre code, or `undefined` when the template lacks exactly three
 * `%s` (performance code, language, theatre) or the shop has no code.
 */
function bookingTemplate(
  shop: z.infer<typeof Shop>,
): { template: string; theatre: string } | undefined {
  const { shop_url: template, code: theatre } = shop;
  const exactlyThree = template?.split("%s").length === 4;
  return template !== undefined && exactlyThree && theatre ? { template, theatre } : undefined;
}

/**
 * Fills the three `%s` left to right by replacement, not formatting: a pre-encoded "%20" elsewhere
 * in the template must not break the fetch. Each value is substituted into the string so far, as in
 * the Python port, so a `%s` inside a value would take the next one's place.
 */
export function fillTemplate(template: string, values: readonly string[]): string {
  return values.reduce((url, value) => url.replace("%s", () => value), template);
}

const nonEmpty = (value: string | undefined): string | undefined =>
  value === "" ? undefined : value;

/** The words that make the legacy site call an event English. */
function includesEnglish(value: string | undefined): boolean {
  const normalized = (value ?? "").toLowerCase();
  return ["english", "ingles", "angl"].some((needle) => normalized.includes(needle));
}

/**
 * The legacy filter: keep a showing only when its event's audio or subtitles are English, and
 * drop films left with none. The parser keeps every event, with its raw labels.
 */
export function legacyEnglishOnly(films: readonly ScrapedFilm[]): ScrapedFilm[] {
  return films.flatMap((film) => {
    const showings = film.showings.filter(
      ({ labels }) => includesEnglish(labels?.audio) || includesEnglish(labels?.subtitles),
    );
    return showings.length > 0 ? [{ ...film, showings }] : [];
  });
}

/** Every event of every recognized shop, in any language, with its raw audio and subtitle labels. */
export function parseShops(
  shops: Readonly<Record<string, unknown>>,
  registry: CinemaRegistry,
  log: Logger,
): ScrapedFilm[] {
  const aliasLookup = buildCinemaAliasLookup(registry, SECONDARY);

  const films: ScrapedFilm[] = [];
  const unrecognized = new Set<string>();

  for (const value of Object.values(shops)) {
    const parsedShop = Shop.safeParse(value);
    if (!parsedShop.success) continue;
    const shop = parsedShop.data;

    const aliases = [shop.label ?? "", shop.name ?? "", shop.slug ?? "", shop.code ?? ""];
    const cinema = aliases
      .map((alias) => aliasLookup.get(normalizeAlias(alias)))
      .find((key) => key !== undefined);
    if (cinema === undefined) {
      for (const alias of aliases) if (alias) unrecognized.add(alias);
      continue;
    }
    const booking = bookingTemplate(shop);

    for (const rawEvent of shop.events ?? []) {
      const event = Event.safeParse(rawEvent);
      if (!event.success) continue;
      const { name, performances, language = "", subtitles_lang: subtitles = "" } = event.data;
      if (!name?.trim() || !performances || performances.length === 0) continue;

      const audio_lang = normalizeAudioLang(language);
      const subtitle_lang = normalizeSubtitleLang(subtitles);
      const showings: ScrapedShowing[] = [];
      for (const rawPerformance of performances) {
        const performance = Performance.safeParse(rawPerformance);
        if (!performance.success) continue;
        const { schedule_date: day, time, performance_code: code } = performance.data;
        if (day?.length !== 8 || time === undefined || time.length < 12) continue;
        const showing = buildShowing({
          cinema,
          date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`,
          time: `${time.slice(8, 10)}:${time.slice(10, 12)}`,
          audio_lang,
          subtitle_lang,
          booking_url:
            booking && code
              ? fillTemplate(booking.template, [code, ADMIT_ONE_ENGLISH, booking.theatre])
              : undefined,
          labels: { audio: language, subtitles },
        });
        if (showing !== undefined) showings.push(showing);
      }
      if (showings.length === 0) continue;
      films.push(scrapedFilm(name.trim(), nonEmpty(event.data.imdbid?.trim()), showings));
    }
  }

  if (unrecognized.size > 0) {
    log.warn("unrecognized_cinema_labels", {
      provider: SECONDARY,
      labels: [...unrecognized].sort(),
    });
  }
  return films;
}

export interface SecondaryOptions {
  /** The listings page; kept out of the repo. */
  listingsUrl: string | undefined;
}

export function secondaryProvider(options: SecondaryOptions): Provider {
  return {
    name: SECONDARY,
    async fetch({ fetcher, registry, log }) {
      if (options.listingsUrl === undefined) {
        throw new NotConfiguredError("SECONDARY_LISTINGS_URL is not set");
      }
      const page = await getOk(fetcher, options.listingsUrl, { timeoutMs: TIMEOUT_MS });
      const shops = extractShops(page.text);
      const films = parseShops(shops, registry, log);
      return { films: reconcile(legacyEnglishOnly(films)), entry: page };
    },
  };
}
