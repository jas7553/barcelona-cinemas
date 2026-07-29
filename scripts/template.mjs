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
// browser blocks the script and the page just quietly stops theming itself.

import { createHash } from "node:crypto";

// Pre-paint theme script: applies the stored dark-mode preference to <html>
// before first paint, so cross-document navigations never flash light→dark.
export const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("btw-dark");var d=s!==null?s==="true":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";var m=document.getElementById("theme-color-meta");if(m)m.content="#0f0e0c";}}catch(e){}})();`;

// Chromium-only progressive enhancement: prerender a film page on tap-intent.
// No-op on Safari (the primary target), which ignores speculation rules.
export const SPECULATION_RULES = JSON.stringify({
  prerender: [{ where: { href_matches: "/film/*" }, eagerness: "moderate" }],
});

/** Every inline script body the site serves, keyed by name for error messages. */
export const INLINE_SCRIPTS = Object.freeze({
  THEME_SCRIPT,
  // Carried in a `type="speculationrules"` block. Chrome enforces script-src
  // against it exactly like an executable inline script, so it needs a hash too.
  SPECULATION_RULES,
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
    <script>${THEME_SCRIPT}</script>
    <link rel="prefetch" href="/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="prefetch" href="/fonts/playfair-display-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=4" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=4" />
    <link rel="icon" type="image/png" sizes="256x256" href="/favicon.png?v=4" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=4" />
    <link rel="shortcut icon" href="/favicon-32x32.png?v=4" />
    <link rel="apple-touch-icon" sizes="256x256" href="/apple-touch-icon.png?v=4" />
    <link rel="mask-icon" href="/safari-pinned-tab.svg?v=4" color="#c17f3a" />
    <meta name="theme-color" content="#faf6ef" id="theme-color-meta" />
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

/**
 * The CloudFront custom-error page (template.yaml maps S3's 403/404 here).
 *
 * Standalone by necessity — it is served for keys that don't exist, so it can't
 * reference a hashed bundle. It used to be a checked-in public/404.html with
 * THEME_SCRIPT pasted in as a string literal; the paste was invisible to the CSP
 * hash and drifted silently. Generated here instead, so there is exactly one
 * copy of the script body and the hash always covers both documents.
 */
export function render404Document() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <script>${THEME_SCRIPT}</script>
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=4" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=4" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=4" />
    <link rel="apple-touch-icon" sizes="256x256" href="/apple-touch-icon.png?v=4" />
    <meta name="theme-color" content="#faf6ef" id="theme-color-meta" />
    <title>Page not found · Barcelona This Week</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      /* This page is standalone (no bundle), so it re-declares the tokens it
         needs. --accent must track --accent-ink in src/style.css, NOT --accent:
         the decorative amber is 3.06:1 on this background and the link here is
         the only way out of the page. 5.54:1 light / 7.36:1 dark. */
      :root { --bg: #faf6ef; --text: #1a1612; --muted: #6b5f52; --accent: #8f5620; }
      html.dark { --bg: #0f0e0c; --text: #f0e8dc; --muted: #9c8c7c; --accent: #d4924a; }
      html { background: var(--bg); color: var(--text); font-family: "DM Sans", system-ui, sans-serif; }
      body { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100svh; padding: 2rem; text-align: center; gap: 1.5rem; }
      .code { font-size: clamp(4rem, 20vw, 8rem); font-weight: 700; line-height: 1; color: var(--accent); font-variant-numeric: tabular-nums; }
      h1 { font-size: clamp(1.25rem, 4vw, 1.75rem); font-weight: 600; }
      p { color: var(--muted); max-width: 30ch; line-height: 1.6; }
      a { color: var(--accent); text-decoration: none; font-weight: 500; border-bottom: 1px solid currentColor; padding-bottom: 1px; }
      a:hover { opacity: 0.8; }
    </style>
  </head>
  <body>
    <div class="code">404</div>
    <h1>Page not found</h1>
    <p>That film page may no longer be showing this week.</p>
    <a href="/">Back to listings</a>
  </body>
</html>
`;
}
