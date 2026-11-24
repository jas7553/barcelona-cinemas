/**
 * Runs collection and enrichment from a cold start, live or from a recording, and prints what each
 * provider gave. Nothing is stored. The sources' config and the TMDb key come from the environment
 * (see `sourceConfigFromEnv`); a recording's `case.json`, when it has one, supplies the instant and
 * the narrowing it was recorded with. Log events go to stderr, the summary to stdout.
 *
 *   npm run refresh:local [-- --replay <recording-dir>] [--out <file>]
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CollectionError, realTimer, type ProviderReport, type Timer } from "./collect.ts";
import { liveFetcher } from "./http.ts";
import type { Logger, LogFields } from "./log.ts";
import { replayFetcher } from "./recordings.ts";
import { collectAndEnrich, type Refreshed } from "./refresh.ts";
import { loadRegistry } from "./registry.ts";
import { liveSources, readReplayCase, sourceConfigFromEnv } from "./sources.ts";

const { values } = parseArgs({
  options: { replay: { type: "string" }, out: { type: "string" } },
});
const startedAt = performance.now();

function stderrLogger(): Logger {
  const write =
    (level: string) =>
    (event: string, fields: LogFields = {}) => {
      process.stderr.write(`${JSON.stringify({ level, event, ...fields })}\n`);
    };
  return { info: write("info"), warn: write("warn"), error: write("error") };
}

const { config: envConfig, missing } = sourceConfigFromEnv(process.env);
const replay = values.replay;
const replayCase =
  replay !== undefined && existsSync(join(replay, "case.json"))
    ? readReplayCase(replay)
    : undefined;
const config = { ...envConfig, ...replayCase?.config };
const now = replayCase?.now ?? new Date();
// A recording answers at once, so a retry there needn't wait.
const timer: Timer =
  replay === undefined ? realTimer : { ...realTimer, sleep: () => Promise.resolve() };

function note({ failure, fallback }: ProviderReport): string {
  const parts: string[] = [];
  if (failure) parts.push(`${failure.outcome}: ${failure.error}`);
  else if (fallback) parts.push("zero films");
  if (fallback?.used) {
    parts.push(
      `snapshot from ${fallback.snapshot_fetched_at}, ${fallback.past_showings_dropped} past showings dropped`,
    );
  } else if (fallback) {
    parts.push(fallback.reason === "stale" ? "snapshot too old" : "no snapshot");
  }
  return parts.join("; ");
}

function providerTable(reports: readonly ProviderReport[]): string {
  const rows = [
    ["provider", "source", "attempts", "films", "showings", "duration", "note"],
    ...reports.map((report) => [
      report.provider,
      report.source,
      String(report.attempts),
      String(report.film_count),
      String(report.showing_count),
      `${report.duration_ms} ms`,
      note(report),
    ]),
  ];
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((row) => row[i]?.length ?? 0))) ?? [];
  return rows
    .map((row) =>
      row
        .map((cell, i) => cell.padEnd(widths[i] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

function tmdbLine({ films, stats }: Refreshed): string {
  if (stats.tmdb_enriched_count === undefined) return "TMDb: skipped (no TMDB_API_KEY)";
  const matched = films.filter((film) => film.tmdb_id !== undefined).length;
  return [
    `TMDb: ${matched} matched, ${films.length - matched} unmatched`,
    `${stats.tmdb_enriched_count} looked up (${stats.tmdb_reenriched_count ?? 0} again)`,
    `${stats.tmdb_cache_hit_count ?? 0} reused, ${stats.tmdb_failure_count ?? 0} failed`,
  ].join("; ");
}

const mode = replay === undefined ? "live" : `replay ${replay}`;
console.log(`refresh:local (${mode}) at ${now.toISOString()}`);
if (replay === undefined && missing.length > 0) console.log(`unset: ${missing.join(", ")}`);
console.log();

try {
  const refreshed = await collectAndEnrich(
    {
      fetcher: replay === undefined ? liveFetcher() : replayFetcher(replay),
      now,
      registry: loadRegistry(),
      log: stderrLogger(),
    },
    {
      providers: liveSources.providers.map((build) => build(config)),
      tmdbApiKey: config.tmdbApiKey,
      timer,
    },
  );
  const { stats, films } = refreshed;
  console.log(providerTable(refreshed.providers));
  console.log();
  console.log(
    `reconcile: ${stats.raw_movie_count} films in, ${stats.collection_merged_count} merged in collection, ` +
      `${stats.post_enrichment_merged_count} after enrichment: ${films.length} films, ` +
      `${films.reduce((sum, film) => sum + film.showings.length, 0)} showings`,
  );
  console.log(tmdbLine(refreshed));
  if (values.out !== undefined) {
    writeFileSync(values.out, `${JSON.stringify(refreshed, null, 2)}\n`);
    console.log(`written to ${values.out}`);
  }
} catch (error) {
  if (!(error instanceof CollectionError)) throw error;
  console.log(providerTable(error.providers));
  console.log();
  console.log(`collection failed: ${error.message}`);
  process.exitCode = 1;
}
console.log(`total: ${((performance.now() - startedAt) / 1000).toFixed(1)} s`);
