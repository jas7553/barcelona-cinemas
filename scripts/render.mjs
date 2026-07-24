// Local SSG renderer → writes pre-rendered pages into static/. Run after
// `vite build` + `vite build --ssr`. Production renders the same pages from S3
// via ssg-lambda/index.mjs (both call render-core.renderAll).
//
//   RENDER_DATA  path to public listings JSON (default static/data/listings.json)
//   SITE_URL     absolute origin for OpenGraph og:url (optional)

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderAll } from "./render-core.mjs";

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
// is allowed to delete there. Keep in sync with ssg-lambda/index.mjs.
const PRUNE_PREFIXES = [
  ["film", ".html"],
  ["data/film", ".json"],
];

let prunedCount = 0;

const { filmCount } = await renderAll({
  listings,
  manifest,
  server,
  siteUrl: process.env.SITE_URL || "",
  write(relPath, contents) {
    const filePath = path.join(OUT, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  },
  // Delete per-film output left over from a previous render whose movie has
  // since dropped out of the listings — mirrors the S3 prune in
  // ssg-lambda/index.mjs. Each prefix only ever sweeps its own file type, so
  // anything else living under these dirs is left alone.
  prune(keepRelPaths) {
    for (const [prefix, ext] of PRUNE_PREFIXES) {
      const dir = path.join(OUT, prefix);
      let names;
      try {
        names = fs.readdirSync(dir);
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

const pruned = prunedCount ? `, pruned ${prunedCount} stale film object(s)` : "";
console.log(`[render] wrote index.html + ${filmCount} film page(s) → static/${pruned}`);
