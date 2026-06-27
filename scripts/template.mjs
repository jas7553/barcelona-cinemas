// Shared HTML document template for the SSG renderer (scripts/render.mjs) and
// the dev-server middleware (vite.config.ts). Keeping one source of truth means
// the dev page and the built page have identical <head> wiring.

// Pre-paint theme script: applies the stored dark-mode preference to <html>
// before first paint, so cross-document navigations never flash light→dark.
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("btw-dark");var d=s!==null?s==="true":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";var m=document.getElementById("theme-color-meta");if(m)m.content="#0f0e0c";}}catch(e){}})();`;

// Chromium-only progressive enhancement: prerender a film page on tap-intent.
// No-op on Safari (the primary target), which ignores speculation rules.
const SPECULATION_RULES = JSON.stringify({
  prerender: [{ where: { href_matches: "/film/*" }, eagerness: "moderate" }],
});

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
