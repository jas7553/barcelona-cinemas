/**
 * What the providers produce, before reconciliation and enrichment. These are the pipeline's own
 * types, not the published document's: slice 3 maps them to `app/shared/listings.ts`.
 */
import type { Fetcher } from "./http.ts";
import type { Logger } from "./log.ts";
import type { CinemaRegistry } from "./registry.ts";

export type AudioLang = "en" | "other";
export type SubtitleLang = "en" | "es" | "ca";

/** Premium large formats, matched as substrings of source labels by `normalizePremiumFormat`. */
export const PREMIUM_FORMATS = ["imax"] as const;
export type PremiumFormat = (typeof PREMIUM_FORMATS)[number];

/** A source's own words for a showing, kept so later stages can re-read them. */
interface SourceLabels {
  /** e.g. Verdi's "V.O.S.E.", SensaCine's "original". */
  version?: string;
  audio?: string;
  subtitles?: string;
  format?: string;
}

export interface ScrapedShowing {
  /** Registry key, e.g. `"VP"`. */
  cinema: string;
  /** Madrid wall clock at Madrid's offset, from `showingStart()`. */
  starts_at: string;
  /** Hard-coded by every provider while they keep only original-version showings. */
  language: "vo";
  audio_lang?: AudioLang;
  subtitle_lang?: SubtitleLang;
  premium_format?: PremiumFormat;
  booking_url?: string;
  labels?: SourceLabels;
}

export interface ScrapedFilm {
  /** As the source lists it. */
  title: string;
  imdb_id?: string;
  showings: ScrapedShowing[];
}

/** The page a provider's listings hang off, for telling a blocked host from an empty programme. */
interface EntryPage {
  url: string;
  status: number;
  contentType: string;
  text: string;
}

export interface ProviderResult {
  films: ScrapedFilm[];
  entry?: EntryPage;
}

/** Everything a pipeline stage reads from outside itself. */
export interface PipelineContext {
  fetcher: Fetcher;
  /** The refresh's instant; nothing below the entry point reads the clock. */
  now: Date;
  registry: CinemaRegistry;
  log: Logger;
}

export interface ProviderContext extends PipelineContext {
  /** Every film the previous refresh's providers returned; empty on a cold start. */
  previousFilms: readonly ScrapedFilm[];
}

export interface Provider {
  readonly name: string;
  fetch(ctx: ProviderContext): Promise<ProviderResult>;
}
