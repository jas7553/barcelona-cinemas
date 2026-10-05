// Shared SSG rendering, independent of where output goes. Both the local
// renderer (scripts/render.mjs → filesystem) and the production Node SSG Lambda
// (ssg-lambda/index.mjs → S3) call renderAll() with their own `write` sink.

import { PRUNE_PREFIXES } from "./site-constants.mjs";
import { renderDocument } from "./template.mjs";

// Writes are S3 PUTs in production: overlap a few rather than run ~400 in turn.
const WRITE_CONCURRENCY = 16;

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
 *   Called once after every write resolves, with the paths under PRUNE_PREFIXES
 *   to keep; sinks delete anything else there. Never runs after a failed write.
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
  // has to be rewritten with every render. Day, film and cinema pages come and
  // go with the listings, so they go through the prune.
  const prunable = new Set();
  const pending = new Set();
  const put = async (...args) => {
    const p = Promise.resolve(write(...args)).finally(() => pending.delete(p));
    pending.add(p);
    if (pending.size >= WRITE_CONCURRENCY) await Promise.race(pending);
  };
  for (const { path, data } of server.sitePages(listings, renderedAt)) {
    if (PRUNE_PREFIXES.some(({ prefix, ext }) => path.startsWith(`${prefix}/`) && path.endsWith(ext))) prunable.add(path);
    const page = server.renderPage(data, siteUrl);
    await put(
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
      { loc: `${siteUrl}/cinemas/`, priority: "0.5", changefreq: "weekly" },
      ...[...new Set(showing.flatMap((m) => m.showtimes.map((s) => s.theater_id)))]
        .sort()
        .map((id) => ({ loc: `${siteUrl}/cinema/${id}/`, priority: "0.5", changefreq: "daily" })),
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
    await put("sitemap.xml", xml, "application/xml");
  }
  await Promise.all(pending);

  // Only after every write: a stale page would 200 forever with a dead hashed bundle.
  if (prune) await prune(prunable);

  return { filmCount: listings.movies.length + (listings.ended_movies?.length ?? 0) };
}
