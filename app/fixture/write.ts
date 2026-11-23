/**
 * Writes the fixture document to a file.
 *
 *   npm run fixture -- <out.json> [--now 2026-11-23T18:00:00+01:00]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { Listings } from "../shared/listings.ts";
import { buildFixture } from "./build.ts";

const { values, positionals } = parseArgs({
  options: { now: { type: "string" } },
  allowPositionals: true,
});
const [out] = positionals;
const now = values.now === undefined ? new Date() : new Date(values.now);
if (out === undefined || positionals.length > 1 || Number.isNaN(now.getTime())) {
  console.error("usage: npm run fixture -- <out.json> [--now <ISO-8601 instant>]");
  process.exit(1);
}

const doc = Listings.parse(buildFixture(now));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
