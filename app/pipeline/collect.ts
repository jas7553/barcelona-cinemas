/**
 * Collection: every provider fetched in parallel, each retried once on a transient failure or an
 * empty result, and a provider that still has nothing standing in with its last good snapshot.
 */
import { errorMessage, FetchError, HttpError, isRetryable, NotConfiguredError } from "./errors.ts";
import type { LogFields } from "./log.ts";
import { countShowings } from "./reconcile.ts";
import type { Provider, ProviderContext, ProviderResult, ScrapedFilm } from "./types.ts";
import { validateFilms } from "./validate.ts";

/** A provider's last good films, as the refresh that fetched them stored them. */
export interface ProviderSnapshot {
  /** ISO-8601 instant of that refresh. */
  fetched_at: string;
  films: ScrapedFilm[];
}

/** Keyed by provider name. */
export type ProviderSnapshots = Readonly<Record<string, ProviderSnapshot>>;

/** Covers two consecutive missed refreshes; older, the upstream schedule has likely moved on. */
const FALLBACK_MAX_AGE_MS = 24 * 3_600_000;

export interface RetryPolicy {
  delayMs: number;
  /** Latest a retry may start, from the provider's first attempt (collection start). */
  startDeadlineMs: number;
}

/**
 * Long enough for a dropped connection or a rate-limit window to clear; late enough a start that
 * the slowest provider's retry still leaves enrichment and publishing room in the run's time limit.
 */
const PROVIDER_RETRY: RetryPolicy = { delayMs: 30_000, startDeadlineMs: 55_000 };

/** A monotonic clock in ms, and a wait on it. */
export interface Timer {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realTimer: Timer = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Why a provider's fetch gave no films: the last attempt's failure and why it wasn't retried. */
interface Failure {
  outcome: "not_configured" | "not_retryable" | "over_budget" | "retry_failed";
  exception_type: string;
  error: string;
  http_status?: number;
  host?: string;
}

type Fallback =
  | {
      used: true;
      snapshot_fetched_at: string;
      snapshot_age_hours: number;
      past_showings_dropped: number;
    }
  | { used: false; reason: "no_snapshot" | "stale"; snapshot_age_hours?: number };

/** One provider's part in a collection, for the refresh's report. */
export interface ProviderReport {
  provider: string;
  /** Where its films came from: this fetch, its snapshot, or nowhere. */
  source: "fresh" | "fallback" | "none";
  attempts: number;
  duration_ms: number;
  /** What it contributed. */
  film_count: number;
  showing_count: number;
  /** Set when every attempt threw. */
  failure?: Failure;
  /** Set when the fetch had no films, whether it threw or came back empty. */
  fallback?: Fallback;
}

export interface Collection {
  /** Every provider's films in provider order, not yet reconciled across providers. */
  films: ScrapedFilm[];
  /** For the next refresh: fresh films at `now`, a fallback's snapshot unchanged. */
  snapshots: Record<string, ProviderSnapshot>;
  providers: ProviderReport[];
}

/** No provider gave fresh films: the caller should keep the last published listings. */
export class CollectionError extends Error {
  override readonly name = "CollectionError";
  readonly providers: readonly ProviderReport[];

  constructor(message: string, providers: readonly ProviderReport[]) {
    super(message);
    this.providers = providers;
  }
}

export interface CollectOptions {
  previousSnapshots?: ProviderSnapshots;
  retry?: RetryPolicy;
  timer?: Timer;
}

function errorFields(error: unknown, { secretUrls = false }: Provider): Omit<Failure, "outcome"> {
  const fields = {
    exception_type: error instanceof Error ? error.name : typeof error,
    error: errorMessage(error, secretUrls),
  };
  const host = (url: string) => (secretUrls ? {} : { host: new URL(url).hostname });
  if (error instanceof HttpError) {
    return { ...fields, http_status: error.status, ...host(error.url) };
  }
  if (error instanceof FetchError) return { ...fields, ...host(error.url) };
  return fields;
}

const BODY_HEAD_CHARS = 300;

/**
 * What tells a blocked host (a bot-challenge page) from an honestly empty programme. A secret
 * source's body can name its URL, so it goes by its size alone.
 */
function entryFields({ entry }: ProviderResult, { secretUrls = false }: Provider): LogFields {
  if (entry === undefined) return {};
  return {
    http_status: entry.status,
    content_type: entry.contentType,
    body_bytes: new TextEncoder().encode(entry.text).length,
    ...(!secretUrls && {
      host: new URL(entry.url).hostname,
      body_head: entry.text
        .slice(0, BODY_HEAD_CHARS * 2)
        .split(/\s+/)
        .filter(Boolean)
        .join(" ")
        .slice(0, BODY_HEAD_CHARS),
    }),
  };
}

type Fetched =
  | { ok: true; result: ProviderResult; attempts: number }
  | { ok: false; failure: Failure; attempts: number };

/** `provider.fetch`, retried once on a transient error or zero films if the budget allows. */
async function fetchWithRetry(
  provider: Provider,
  ctx: ProviderContext,
  retry: RetryPolicy,
  timer: Timer,
): Promise<Fetched> {
  const firstStarted = timer.now();
  const retryFits = (): boolean =>
    timer.now() - firstStarted + retry.delayMs <= retry.startDeadlineMs;
  for (let attempt = 1; ; attempt++) {
    const attemptStarted = timer.now();
    const attemptFields = (): LogFields => ({
      provider: provider.name,
      attempt,
      elapsed_ms: Math.round(timer.now() - attemptStarted),
      total_elapsed_ms: Math.round(timer.now() - firstStarted),
    });
    let result: ProviderResult;
    try {
      result = await provider.fetch(ctx);
    } catch (error) {
      const details = errorFields(error, provider);
      const fields = { ...attemptFields(), ...details };
      let outcome: Failure["outcome"] | undefined;
      if (error instanceof NotConfiguredError) outcome = "not_configured";
      else if (attempt > 1) outcome = "retry_failed";
      else if (!isRetryable(error)) outcome = "not_retryable";
      else if (!retryFits()) outcome = "over_budget";
      if (outcome === undefined) {
        ctx.log.warn("provider_retry", { ...fields, retry_delay_ms: retry.delayMs });
        await timer.sleep(retry.delayMs);
        continue;
      }
      ctx.log.warn("collection_failure", { ...fields, outcome });
      return { ok: false, failure: { outcome, ...details }, attempts: attempt };
    }
    if (result.films.length > 0 || attempt > 1 || !retryFits()) {
      return { ok: true, result, attempts: attempt };
    }
    ctx.log.warn("provider_retry", {
      ...attemptFields(),
      reason: "zero_result",
      retry_delay_ms: retry.delayMs,
      ...entryFields(result, provider),
    });
    await timer.sleep(retry.delayMs);
  }
}

/**
 * A snapshot's films minus the showings that have started, or why it can't stand in: there's
 * none, or it's older than `FALLBACK_MAX_AGE_MS`. A showing starting this minute is kept.
 */
function fallbackFilms(
  snapshot: ProviderSnapshot | undefined,
  now: Date,
): { films: ScrapedFilm[]; fallback: Fallback } {
  if (snapshot === undefined)
    return { films: [], fallback: { used: false, reason: "no_snapshot" } };
  const ageMs = now.getTime() - Date.parse(snapshot.fetched_at);
  const snapshot_age_hours = Math.round(ageMs / 360_000) / 10;
  // An unreadable `fetched_at` makes the age NaN, which fails this test too.
  if (!(ageMs <= FALLBACK_MAX_AGE_MS)) {
    return {
      films: [],
      fallback: {
        used: false,
        reason: "stale",
        ...(!Number.isNaN(snapshot_age_hours) && { snapshot_age_hours }),
      },
    };
  }
  const cutoff = Math.floor(now.getTime() / 60_000) * 60_000;
  let dropped = 0;
  const films = snapshot.films.flatMap((film) => {
    const showings = film.showings.filter((showing) => Date.parse(showing.starts_at) >= cutoff);
    dropped += film.showings.length - showings.length;
    return showings.length > 0 ? [{ ...film, showings }] : [];
  });
  return {
    films,
    fallback: {
      used: true,
      snapshot_fetched_at: snapshot.fetched_at,
      snapshot_age_hours,
      past_showings_dropped: dropped,
    },
  };
}

interface ProviderOutcome {
  films: ScrapedFilm[];
  snapshot: ProviderSnapshot | undefined;
  report: ProviderReport;
}

async function collectOne(
  provider: Provider,
  ctx: ProviderContext,
  previous: ProviderSnapshot | undefined,
  { retry, timer }: { retry: RetryPolicy; timer: Timer },
): Promise<ProviderOutcome> {
  const started = timer.now();
  const fetched = await fetchWithRetry(provider, ctx, retry, timer);
  const duration_ms = Math.round(timer.now() - started);
  const base = { provider: provider.name, attempts: fetched.attempts, duration_ms };

  if (fetched.ok) {
    const films = validateFilms(fetched.result.films, provider.name, ctx.log);
    if (films.length === 0) {
      ctx.log.warn("provider_zero_result", {
        provider: provider.name,
        ...entryFields(fetched.result, provider),
      });
    }
    ctx.log.info("provider_collection_summary", {
      provider: provider.name,
      duration_ms,
      movie_count: films.length,
      showtime_count: countShowings(films),
    });
    if (films.length > 0) {
      return {
        films,
        snapshot: { fetched_at: ctx.now.toISOString(), films },
        report: {
          ...base,
          source: "fresh",
          film_count: films.length,
          showing_count: countShowings(films),
        },
      };
    }
  }

  // Zero films counts as a failure here too: a bot-challenge page parses to nothing.
  const trigger = fetched.ok ? "zero_result" : "failure";
  const failure = fetched.ok ? {} : { failure: fetched.failure };
  const { films, fallback } = fallbackFilms(previous, ctx.now);
  if (!fallback.used) {
    ctx.log.warn("provider_fallback_unavailable", {
      provider: provider.name,
      trigger,
      reason: fallback.reason,
      snapshot_age_hours: fallback.snapshot_age_hours,
    });
    return {
      films: [],
      snapshot: undefined,
      report: { ...base, source: "none", film_count: 0, showing_count: 0, ...failure, fallback },
    };
  }
  const showing_count = countShowings(films);
  ctx.log.warn("provider_fallback", {
    provider: provider.name,
    trigger,
    snapshot_fetched_at: fallback.snapshot_fetched_at,
    snapshot_age_hours: fallback.snapshot_age_hours,
    movie_count: films.length,
    showtime_count: showing_count,
    past_showtime_dropped_count: fallback.past_showings_dropped,
  });
  return {
    films,
    // Unchanged, original `fetched_at` included, so repeated failures age it out.
    snapshot: previous,
    report: {
      ...base,
      source: "fallback",
      film_count: films.length,
      showing_count,
      ...failure,
      fallback,
    },
  };
}

/**
 * Results keep provider order whichever provider answers first. Throws
 * `CollectionError` when every provider failed, or when those that answered had no films, whatever
 * the snapshots hold.
 */
export async function collect(
  providers: readonly Provider[],
  ctx: ProviderContext,
  { previousSnapshots = {}, retry = PROVIDER_RETRY, timer = realTimer }: CollectOptions = {},
): Promise<Collection> {
  const outcomes = await Promise.all(
    providers.map((provider) =>
      collectOne(provider, ctx, previousSnapshots[provider.name], { retry, timer }),
    ),
  );
  const reports = outcomes.map(({ report }) => report);
  if (reports.every(({ failure }) => failure !== undefined)) {
    throw new CollectionError("All providers failed to return listings", reports);
  }
  if (!reports.some(({ source }) => source === "fresh")) {
    throw new CollectionError("Providers answered but none returned films", reports);
  }
  const snapshots: Record<string, ProviderSnapshot> = {};
  for (const { report, snapshot } of outcomes) {
    if (snapshot !== undefined) snapshots[report.provider] = snapshot;
  }
  return { films: outcomes.flatMap(({ films }) => films), snapshots, providers: reports };
}
