/**
 * Records every live source's HTTP for replay in tests. Reads the sources' config from the
 * environment, which `npm run record` loads from `.env` (see `sourceConfigFromEnv`).
 *
 *   npm run record [-- <out-dir>]   default: app/pipeline/fixtures/recorded/live-<Madrid date>-<HHMM>
 */
import { parseArgs } from "node:util";
import { madridWallClock } from "../shared/madrid.ts";
import { consoleLogger } from "./log.ts";
import { loadRegistry } from "./registry.ts";
import { liveSources, recordSources, sourceConfigFromEnv } from "./sources.ts";

const { positionals } = parseArgs({ allowPositionals: true });
if (positionals.length > 1) {
  console.error("usage: npm run record [-- <out-dir>]");
  process.exit(1);
}
const now = new Date();
const { date, time } = madridWallClock(now);
const outDir =
  positionals[0] ?? `app/pipeline/fixtures/recorded/live-${date}-${time.replace(":", "")}`;

const log = consoleLogger({ run: "record" });
const { config, missing } = sourceConfigFromEnv(process.env);
if (missing.length > 0) log.warn("record_config_missing", { env_vars: missing });

const failed = await recordSources(liveSources, config, {
  outDir,
  now,
  registry: loadRegistry(),
  log,
});
log.info("record_done", { out_dir: outDir, failed });
if (failed.length > 0) process.exitCode = 1;
