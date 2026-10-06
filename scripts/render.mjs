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

// `npm run build` sets TZ; this catches it being dropped.
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
  listings = { generated_at: new Date().toISOString(), theaters: [], movies: [] };
}

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
  // Mirrors the S3 prune in ssg-lambda/index.mjs.
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
console.log(`[render] wrote the site for ${filmCount} film(s) → static/${pruned}`);
