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
 * @param {object} o.server     The entry-server module (renderList/renderFilm/renderPrivacy/filmListings).
 * @param {string} [o.siteUrl]  Absolute origin for OpenGraph og:url.
 * @param {(relPath: string, contents: string, contentType: string) => (void|Promise<void>)} o.write
 * @param {(keepRelPaths: Set<string>) => (void|Promise<void>)} [o.prune]
 *   Optional sink for deleting stale output. Called exactly once, only after
 *   every write above has resolved, with the full set of per-film paths this
 *   render produced — both `film/<id>.html` and `data/film/<id>.json`. Sinks
 *   sweep those two prefixes and delete anything not in the set. A partial
 *   render must never delete anything, so a throwing write short-circuits
 *   before prune ever runs. Omit it and nothing is deleted (previous
 *   behaviour).
 * @returns {Promise<{filmCount: number}>}
 */
export async function renderAll({ listings, manifest, server, siteUrl = "", write, prune }) {
  const renderedAt = new Date().toISOString();
  const listAssets = assets(manifest, "src/entry-list.tsx");
  const filmAssets = assets(manifest, "src/entry-film.tsx");
  const privacyAssets = assets(manifest, "src/entry-privacy.tsx");

  // List page
  const listData = { renderedAt, listings };
  const listPage = server.renderList(listData, siteUrl);
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

  // Privacy page (static prose — no per-render data, always present)
  const privacyPage = server.renderPrivacy(siteUrl);
  await write(
    "privacy.html",
    renderDocument({
      title: privacyPage.title,
      headExtra: privacyPage.headExtra,
      bodyHtml: privacyPage.html,
      data: null,
      entrySrc: privacyAssets.js,
      cssHrefs: privacyAssets.css,
      preload: privacyAssets.preload,
    }),
    "text/html; charset=utf-8",
  );

  // Film pages — render all synchronously then flush all writes in parallel.
  const filmOutputs = new Set();
  const filmJobs = listings.movies.map((movie) => {
    filmOutputs.add(`film/${movie.id}.html`);
    filmOutputs.add(`data/film/${movie.id}.json`);
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

  // sitemap.xml — absolute URLs require a siteUrl, so skip it for local builds
  // that don't set SITE_URL. List only films actually screening: the rest render
  // a noindex "not showing" page (see renderFilm) and don't belong in the index.
  if (siteUrl) {
    const showing = listings.movies.filter((m) => m.showtimes && m.showtimes.length > 0);
    const lastmod = (listings.generated_at || renderedAt).slice(0, 10);
    const entries = [
      { loc: `${siteUrl}/`, priority: "1.0", changefreq: "daily" },
      ...showing.map((m) => ({ loc: `${siteUrl}/film/${m.id}`, priority: "0.7", changefreq: "daily" })),
      { loc: `${siteUrl}/privacy`, priority: "0.3", changefreq: "yearly" },
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

  // Every write landed — now, and only now, it is safe to drop per-film output
  // for movies that fell out of the listings. Left behind, a stale page 200s
  // forever with a dead hashed /assets/* bundle (deleted by the next deploy),
  // so it never hydrates and serves frozen showtimes still labelled "Today";
  // its sibling JSON just accumulates in the bucket.
  if (prune) await prune(filmOutputs);

  return { filmCount: listings.movies.length };
}
