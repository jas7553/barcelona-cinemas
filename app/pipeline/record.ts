/**
 * Records every live source's HTTP for replay in tests. Reads the sources' config from the
 * environment (see `sourceConfigFromEnv`).
 *
 *   npm run record -- <out-dir>
 */
import { parseArgs } from "node:util";
import { consoleLogger } from "./log.ts";
import { loadRegistry } from "./registry.ts";
import { liveSources, recordSources, sourceConfigFromEnv } from "./sources.ts";

const { positionals } = parseArgs({ allowPositionals: true });
const [outDir] = positionals;
if (outDir === undefined || positionals.length > 1) {
  console.error("usage: npm run record -- <out-dir>");
  process.exit(1);
}

const log = consoleLogger({ run: "record" });
const { config, missing } = sourceConfigFromEnv(process.env);
if (missing.length > 0) log.warn("record_config_missing", { env_vars: missing });

const failed = await recordSources(liveSources, config, {
  outDir,
  now: new Date(),
  registry: loadRegistry(),
  log,
});
log.info("record_done", { out_dir: outDir, failed });
if (failed.length > 0) process.exitCode = 1;
