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
});

console.log(`[render] wrote index.html + ${filmCount} film page(s) → static/`);
