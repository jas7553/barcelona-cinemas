// The HTML document (SSG and dev middleware) and every inline script the site
// ships. CSP allows inline scripts only by hash: cspScriptHashes() derives them
// and template.test.mjs fails if template.yaml's copies drift. A stale hash
// fails silently in prod only, where the browser blocks the script.

import { createHash } from "node:crypto";

// Pre-paint: marks <html> when a Home is saved, so the header's Home pill
// renders in its set state on first paint instead of flipping after hydration.
// The key must match PREF_KEYS.home in src/domain/prefs.ts (template.test.mjs checks).
export const PREFS_SCRIPT = `(function(){try{if(localStorage.getItem("btw-home"))document.documentElement.classList.add("has-home");}catch(e){}})();`;

// Pre-paint: hides seen films' rows where hydration moves them to the Seen
// group, marks them data-seen where they stay (data-seen-last lists, sorted last
// by CSS), and presses the film page's Seen toggle. Key = PREF_KEYS.seen.
export const SEEN_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem("btw-seen")||"[]");if(!s.length)return;function each(a,f){var l=document.querySelectorAll("["+a+"]");for(var i=0;i<l.length;i++)if(s.indexOf(l[i].getAttribute(a))>=0)f(l[i]);}each("data-seen-toggle",function(e){e.setAttribute("aria-pressed","true");});each("data-film",function(e){if(e.parentNode.hasAttribute("data-seen-last"))e.setAttribute("data-seen","");else e.hidden=true;});}catch(e){}})();`;

// Pre-paint: presses My cinemas toggles and orders each [data-sort] list by
// CSS order: favourites, then the nearest, then server order (a stable sort,
// so it must already be the client's tie-break). data-head items lead their
// group. Must match byCinema and cinemaOrder; keys = PREF_KEYS.
export const ORDER_SCRIPT = `(function(){try{var h=JSON.parse(localStorage.getItem("btw-home")||"null"),f=JSON.parse(localStorage.getItem("btw-fav")||"[]");if(!h||typeof h.lat!=="number"||typeof h.lng!=="number")h=null;if(!Array.isArray(f))f=[];if(!h&&!f.length)return;var P=document.querySelectorAll("[data-fav]");for(var i=0;i<P.length;i++)if(f.indexOf(P[i].getAttribute("data-fav"))>=0)P[i].setAttribute("aria-pressed","true");var r=Math.PI/180;function km(e){var a=parseFloat(e.getAttribute("data-lat")),b=parseFloat(e.getAttribute("data-lng"));if(!h||isNaN(a)||isNaN(b))return Infinity;var x=Math.sin((a-h.lat)*r/2),y=Math.sin((b-h.lng)*r/2);return 12742*Math.asin(Math.sqrt(x*x+Math.cos(h.lat*r)*Math.cos(a*r)*y*y));}var L=document.querySelectorAll("[data-sort]");for(i=0;i<L.length;i++){var k=[].map.call(L[i].children,function(e){var hd=e.getAttribute("data-head");return hd?{e:e,f:hd==="mine"?0:1,d:-Infinity}:{e:e,f:f.indexOf(e.getAttribute("data-id"))<0?1:0,d:km(e)};});k.sort(function(a,b){return a.f-b.f||(a.d<b.d?-1:a.d>b.d?1:0);});for(var j=0;j<k.length;j++)k[j].e.style.order=j;}}catch(e){}})();`;

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
// inline in <head> rather than in the hydration entry. Both sides skip: the
// outgoing page (`pageswap`) and the incoming one (`pagereveal`).
export const VIEW_TRANSITION_SCRIPT = `(function(){function skip(e,a){try{var v=e.viewTransition;if(!v)return;v.ready.catch(function(){});if(a&&a.navigationType==="traverse")v.skipTransition();}catch(t){}}window.addEventListener("pageswap",function(e){skip(e,e.activation);});window.addEventListener("pagereveal",function(e){skip(e,navigation.activation);});})();`;

/** Every inline script body the site serves, keyed by name for error messages. */
export const INLINE_SCRIPTS = Object.freeze({
  PREFS_SCRIPT,
  SEEN_SCRIPT,
  ORDER_SCRIPT,
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
    <script>${SEEN_SCRIPT}</script>
    <script>${ORDER_SCRIPT}</script>
    <script type="application/json" id="__APP_DATA__">${dataJson}</script>
    <script type="speculationrules">${SPECULATION_RULES}</script>
    <script type="module" src="${o.entrySrc}"></script>
  </body>
</html>
`;
}
