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
    // Vite can hoist CSS into a shared chunk; the page still needs it.
    for (const c of chunk.css || []) css.add("/" + c);
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
 * @param {object} o.server     The entry-server module (sitePages/renderPage).
 * @param {string} [o.siteUrl]  Absolute origin for OpenGraph og:url.
 * @param {string} [o.renderedAt]  ISO instant to render at (default: now). Pinned only for visual comparison.
 * @param {(relPath: string, contents: string, contentType: string) => (void|Promise<void>)} o.write
 * @param {(keepRelPaths: Set<string>) => (void|Promise<void>)} [o.prune]
 *   Optional sink for deleting stale output. Called exactly once, only after
 *   every write above has resolved, with the full set of film and day paths
 *   this render produced — `film/<id>.html`, `film/<id>/<date>.html` and
 *   `day/<date>.html`. Sinks sweep those prefixes and delete anything not in
 *   the set; `data/film/` is still swept, and nothing is kept there. A partial
 *   render must never delete anything, so a throwing write short-circuits
 *   before prune ever runs. Omit it and nothing is deleted (previous
 *   behaviour).
 * @returns {Promise<{filmCount: number}>}
 */
export async function renderAll({
  listings,
  manifest,
  server,
  siteUrl = "",
  renderedAt = new Date().toISOString(),
  write,
  prune,
}) {
  const clientAssets = assets(manifest, "src/client.tsx");

  await write("data/listings.json", JSON.stringify(listings), "application/json");

  // Every page, 404.html included: it links the current hashed bundle, so it
  // has to be rewritten with every render. Day and film pages come and go with
  // the listings, so they go through the prune.
  const prunable = new Set();
  for (const { path, data } of server.sitePages(listings, renderedAt)) {
    if (path.startsWith("day/") || path.startsWith("film/")) prunable.add(path);
    const page = server.renderPage(data, siteUrl);
    await write(
      path,
      renderDocument({
        title: page.title,
        headExtra: page.headExtra,
        bodyHtml: page.html,
        data,
        entrySrc: clientAssets.js,
        cssHrefs: clientAssets.css,
        preload: clientAssets.preload,
        notFound: data.page === "not-found",
      }),
      "text/html; charset=utf-8",
    );
  }

  // sitemap.xml — absolute URLs require a siteUrl, so skip it for local builds
  // that don't set SITE_URL. List only films actually screening: the rest render
  // a noindex "No more showings" page and don't belong in the index.
  if (siteUrl) {
    const showing = listings.movies.filter((m) => m.showtimes && m.showtimes.length > 0);
    const lastmod = (listings.generated_at || renderedAt).slice(0, 10);
    const entries = [
      { loc: `${siteUrl}/`, priority: "1.0", changefreq: "daily" },
      ...showing.map((m) => ({ loc: `${siteUrl}/film/${m.id}/`, priority: "0.7", changefreq: "daily" })),
      { loc: `${siteUrl}/privacy/`, priority: "0.3", changefreq: "yearly" },
    ];
    const urls = entries
      .map(
        (e) =>
          `  <url>\n    <loc>${e.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n` +
          `    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`,
      )
      .join("\n");
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    await write("sitemap.xml", xml, "application/xml");
  }

  // Every write landed — now, and only now, it is safe to drop film pages
  // that fell out of the listings and day pages now in the past. Left behind,
  // a stale page 200s forever with a dead hashed /assets/* bundle (deleted by
  // the next deploy), so it never hydrates and serves frozen showtimes still
  // labelled "Today".
  if (prune) await prune(prunable);

  return { filmCount: listings.movies.length + (listings.ended_movies?.length ?? 0) };
}
