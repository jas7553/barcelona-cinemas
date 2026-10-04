// Local SSG renderer → writes pre-rendered pages into static/. Run after
// `vite build` + `vite build --ssr`. Production renders the same pages from S3
// via ssg-lambda/index.mjs (both call render-core.renderAll).
//
//   RENDER_DATA  path to public listings JSON (default static/data/listings.json)
//   SITE_URL     absolute origin for OpenGraph og:url (optional)
//   RENDERED_AT  ISO instant to render at instead of now (optional; visual comparison)

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderAll } from "./render-core.mjs";
import { assertSiteTimezone, prunePrefixesFs } from "./site-constants.mjs";

// Fail the build rather than bake wrong dates. `npm run build` sets TZ for this
// command; if that ever gets dropped, this is what catches it.
assertSiteTimezone("scripts/render.mjs");

const ROOT = process.cwd();
const OUT = path.join(ROOT, "static");

const manifest = JSON.parse(fs.readFileSync(path.join(OUT, ".vite", "manifest.json"), "utf8"));
const server = await import(pathToFileURL(path.join(ROOT, "dist-ssr", "entry-server.js")).href);

const dataPath = process.env.RENDER_DATA || path.join(OUT, "data", "listings.json");
let listings;
try {
  listings = JSON.parse(fs.readFileSync(dataPath, "utf8"));
} catch {
  console.warn(`[render] no data at ${dataPath} — emitting an empty list page only`);
  listings = { generated_at: new Date().toISOString(), stale: false, theaters: [], movies: [] };
}

// Per-film output dirs the prune sweeps, each paired with the only extension it
// is allowed to delete there — derived from the shared constant, in this sink's
// dialect (relative dirs for path.join). See scripts/site-constants.mjs.
const PRUNE_PREFIXES = prunePrefixesFs();

let prunedCount = 0;

const { filmCount } = await renderAll({
  listings,
  manifest,
  server,
  siteUrl: process.env.SITE_URL || "",
  renderedAt: process.env.RENDERED_AT || undefined,
  write(relPath, contents) {
    const filePath = path.join(OUT, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  },
  // Delete film pages left over from a previous render whose movie has since
  // dropped out of the listings, and day pages now in the past — mirrors the S3 prune in
  // ssg-lambda/index.mjs. Each prefix only ever sweeps its own file type, so
  // anything else living under these dirs is left alone.
  prune(keepRelPaths) {
    for (const [prefix, ext] of PRUNE_PREFIXES) {
      const dir = path.join(OUT, prefix);
      let names;
      try {
        // Recursive: dated film pages sit one level down, at film/<id>/<date>.html.
        names = fs.readdirSync(dir, { recursive: true });
      } catch {
        continue; // dir not there yet (first render, or vite build emptied static/)
      }
      for (const name of names) {
        if (!name.endsWith(ext)) continue;
        if (keepRelPaths.has(`${prefix}/${name}`)) continue;
        fs.unlinkSync(path.join(dir, name));
        prunedCount++;
      }
    }
  },
});

const pruned = prunedCount ? `, pruned ${prunedCount} stale page object(s)` : "";
console.log(`[render] wrote index.html, day pages, privacy.html, 404.html + pages for ${filmCount} film(s) → static/${pruned}`);
