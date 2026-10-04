// Shared HTML document template for the SSG renderer (scripts/render.mjs) and
// the dev-server middleware (vite.config.ts). Keeping one source of truth means
// the dev page and the built page have identical <head> wiring.
//
// This module is also the single owner of every inline <script> the site ships.
// CSP `script-src` is 'self' plus a sha256 allowance per inline block, and those
// hashes live in template.yaml — where nothing can compute them. So: the bodies
// are declared here exactly once, cspScriptHashes() derives the hashes from
// them, and scripts/template.test.mjs fails if template.yaml has stale ones.
// A stale hash is a silent prod-only failure (dev serves no CSP at all): the
// browser blocks the script and the page quietly loses what it did.

import { createHash } from "node:crypto";

// Pre-paint: marks <html> when a Home is saved, so the header's Home pill
// renders in its set state on first paint instead of flipping after hydration.
// The key must match PREF_KEYS.home in src/domain/prefs.ts (template.test.mjs checks).
export const PREFS_SCRIPT = `(function(){try{if(localStorage.getItem("btw-home"))document.documentElement.classList.add("has-home");}catch(e){}})();`;

// 404 page only. Dated pages (/day/<date>/, /film/<id>/<date>/,
// /cinema/<id>/<date>/) are dropped once their day passes, so a shared or
// bookmarked one lands here; send it on to the undated page instead.
export const EXPIRED_REDIRECT_SCRIPT = `(function(){var m=location.pathname.match(/^\\/(?:day|(film|cinema)\\/([^\\/]+))\\/\\d{4}-\\d{2}-\\d{2}\\/?$/);if(m)location.replace(m[1]?"/"+m[1]+"/"+m[2]+"/":"/");})();`;

// Chromium-only progressive enhancement: prerender a film page on tap-intent.
// No-op on Safari (the primary target), which ignores speculation rules.
export const SPECULATION_RULES = JSON.stringify({
  prerender: [{ where: { href_matches: "/film/*" }, eagerness: "moderate" }],
});

// Skips the view transition on back/forward navigation, so bfcache restores
// stay instant. Must be registered before `pagereveal` can fire, hence
// inline in <head> rather than in the hydration entry.
// Skipping rejects the transition's `ready` promise, so that's caught too.
export const VIEW_TRANSITION_SCRIPT = `(function(){window.addEventListener("pagereveal",function(e){try{var v=e.viewTransition;if(v&&navigation.activation&&navigation.activation.navigationType==="traverse"){v.ready.catch(function(){});v.skipTransition();}}catch(t){}});})();`;

/** Every inline script body the site serves, keyed by name for error messages. */
export const INLINE_SCRIPTS = Object.freeze({
  PREFS_SCRIPT,
  EXPIRED_REDIRECT_SCRIPT,
  // Carried in a `type="speculationrules"` block. Chrome enforces script-src
  // against it exactly like an executable inline script, so it needs a hash too.
  SPECULATION_RULES,
  VIEW_TRANSITION_SCRIPT,
});

/**
 * CSP source-expressions for every inline script, derived from the bodies above.
 * These are the strings that must appear verbatim in template.yaml's script-src.
 *
 * @returns {Record<string, string>} name → `'sha256-…='`
 */
export function cspScriptHashes() {
  return Object.fromEntries(
    Object.entries(INLINE_SCRIPTS).map(([name, body]) => [
      name,
      `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`,
    ]),
  );
}

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.headExtra      Extra <head> tags (meta/OG), already escaped.
 * @param {string} o.bodyHtml       SSR markup for #root.
 * @param {unknown} o.data          Hydration payload (embedded as inert JSON).
 * @param {string} o.entrySrc       Module script src for the hydration entry.
 * @param {string[]} [o.cssHrefs]   Stylesheet hrefs (prod build only).
 * @param {string[]} [o.preload]    Module-preload hrefs (prod build only).
 * @param {boolean} [o.notFound]    The 404 document: adds the expired-page redirect.
 */
export function renderDocument(o) {
  const cssLinks = (o.cssHrefs ?? []).map((h) => `<link rel="stylesheet" href="${h}" />`).join("\n    ");
  const preloads = (o.preload ?? []).map((h) => `<link rel="modulepreload" href="${h}" />`).join("\n    ");
  // Embedded as type="application/json" (NOT executed), so a tight CSP
  // script-src needs no per-page hash. Escape "<" so a synopsis containing
  // "</script>" can't break out of the element.
  const dataJson = JSON.stringify(o.data).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="google-site-verification" content="8TY-GdWfEzMusHB1CLdFZYqlrJIE-p0LsmxkoAeuK7M" />
    ${o.notFound ? `<script>${EXPIRED_REDIRECT_SCRIPT}</script>\n    ` : ""}<script>${PREFS_SCRIPT}</script>
    <script>${VIEW_TRANSITION_SCRIPT}</script>
    <link rel="preload" href="/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/playfair-display-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=4" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=4" />
    <link rel="icon" type="image/png" sizes="256x256" href="/favicon.png?v=4" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=4" />
    <link rel="shortcut icon" href="/favicon-32x32.png?v=4" />
    <link rel="apple-touch-icon" sizes="256x256" href="/apple-touch-icon.png?v=4" />
    <link rel="mask-icon" href="/safari-pinned-tab.svg?v=4" color="#c17f3a" />
    <meta name="theme-color" content="#faf6ef" />
    <link rel="manifest" href="/site.webmanifest" />
    ${o.headExtra}
    <link rel="preconnect" href="https://image.tmdb.org" />
    ${cssLinks}
    ${preloads}
    <title>${o.title}</title>
  </head>
  <body>
    <div id="root">${o.bodyHtml}</div>
    <script type="application/json" id="__APP_DATA__">${dataJson}</script>
    <script type="speculationrules">${SPECULATION_RULES}</script>
    <script type="module" src="${o.entrySrc}"></script>
  </body>
</html>
`;
}
