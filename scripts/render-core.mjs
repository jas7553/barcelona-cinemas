// Shared SSG rendering, independent of where output goes. Both the local
// renderer (scripts/render.mjs → filesystem) and the production Node SSG Lambda
// (ssg-lambda/index.mjs → S3) call renderAll() with their own `write` sink.

import { renderDocument } from "./template.mjs";

/** Resolve a manifest entry's JS file, CSS hrefs, and module-preload chunks. */
export function assets(manifest, entryKey) {
  const entry = manifest[entryKey];
  if (!entry) throw new Error(`manifest missing entry ${entryKey} — did vite build run?`);
  const css = new Set((entry.css || []).map((f) => "/" + f));
  const preload = new Set();
  for (const imp of entry.imports || []) {
    const chunk = manifest[imp];
    if (!chunk) continue;
    // Always collect a chunk's CSS (Vite may hoist global style.css into a
    // shared chunk), but skip preloading hydration-only hooks (useLocationPin).
    for (const c of chunk.css || []) css.add("/" + c);
    if (chunk.file.includes("useLocationPin")) continue;
    preload.add("/" + chunk.file);
  }
  return { js: "/" + entry.file, css: [...css], preload: [...preload] };
}

/**
 * Render the whole site from public listings.
 *
 * @param {object} o
 * @param {object} o.listings   Public listings payload ({generated_at, stale, theaters, movies}).
 * @param {object} o.manifest   Vite client build manifest.
 * @param {object} o.server     The entry-server module (renderList/renderFilm/filmListings).
 * @param {string} [o.siteUrl]  Absolute origin for OpenGraph og:url.
 * @param {(relPath: string, contents: string, contentType: string) => (void|Promise<void>)} o.write
 * @returns {Promise<{filmCount: number}>}
 */
export async function renderAll({ listings, manifest, server, siteUrl = "", write }) {
  const renderedAt = new Date().toISOString();
  const listAssets = assets(manifest, "src/entry-list.tsx");
  const filmAssets = assets(manifest, "src/entry-film.tsx");

  // List page
  const listData = { renderedAt, listings };
  const listPage = server.renderList(listData);
  await write(
    "index.html",
    renderDocument({
      title: listPage.title,
      headExtra: listPage.headExtra,
      bodyHtml: listPage.html,
      data: listData,
      entrySrc: listAssets.js,
      cssHrefs: listAssets.css,
      preload: listAssets.preload,
    }),
    "text/html; charset=utf-8",
  );
  await write("data/listings.json", JSON.stringify(listings), "application/json");

  // Film pages — render all synchronously then flush all writes in parallel.
  const filmJobs = listings.movies.map((movie) => {
    const filmData = { renderedAt, listings: server.filmListings(listings, movie.id), filmId: movie.id };
    const page = server.renderFilm(filmData, siteUrl);
    return Promise.all([
      write(
        `film/${movie.id}.html`,
        renderDocument({
          title: page.title,
          headExtra: page.headExtra,
          bodyHtml: page.html,
          data: filmData,
          entrySrc: filmAssets.js,
          cssHrefs: filmAssets.css,
          preload: filmAssets.preload,
        }),
        "text/html; charset=utf-8",
      ),
      write(`data/film/${movie.id}.json`, JSON.stringify(filmData), "application/json"),
    ]);
  });
  await Promise.all(filmJobs);

  return { filmCount: listings.movies.length };
}
