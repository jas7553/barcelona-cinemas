# SPEC — SPA → MPA Refactor (FINALIZED for handoff)

Status: **finalized.** Phases 1 (SPEC) + 2 (EXPLORE) complete. Ready for a
fresh-session agent to execute Phase 3 (BUILD).
Branch: `mpa-refactor`. No feature code committed yet — only this spec + the
throwaway probe (removed).

This document folds the EXPLORE evidence back into the spec. It answers the six
Phase-1 points, records what the spikes proved, and ends with a BUILD plan and
the checks that still need a **real iOS Safari device pass** (the executing agent
or the owner must do these — they cannot be validated in-repo).

---

## 0. The finding that drives everything (verified in EXPLORE)

Primary user is **iPhone/Safari**. The motivating pain is iOS Safari swipe-back,
scroll restoration, back/forward.

| Feature | Buys | iOS Safari support (verified June 2026) |
|---|---|---|
| **bfcache + native back/forward/swipe-back** | Instant, pixel-exact **back** nav + correct scroll restoration — the exact things broken today | ✅ Full. The core win. |
| **Cross-document View Transitions** | Smooth poster→detail morph on **forward** nav | ⚠️ **iOS 18.4+ only.** No morph below that. |
| **Speculation Rules `prerender`** | Forward nav feels instant (next page prerendered on tap-intent) | ❌ **Chromium-only. Not Safari.** WebKit work in progress, nothing shipped as of June 2026. |

**Consequence — the load-bearing conclusion:**
- The **back** direction (today's bug) is fixed **for free** by going MPA, for
  the exact user who hurts.
- The **forward** direction cannot use Speculation Rules on Safari at all, and
  gets the View Transition morph only on iOS 18.4+. So on Safari, **the only way
  to guarantee "no white flash on forward nav" is for the destination document
  to paint real content on its first frame** — i.e. **pre-rendered HTML (SSG)**,
  not a client-rendered shell that fetches-then-paints.

This is why the spec commits to **SSG content**, not a static shell. It is a
direct consequence of the user being on Safari. **Verdict: do the refactor** —
large free back-direction wins on the reported pain; forward risk fully
addressable with SSG + (where available) View Transitions.

Sources: [WebKit 18.2 features](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/),
[View Transitions (cross-document) browser support](https://www.testmuai.com/web-technologies/cross-document-view-transitions/),
[Speculation Rules API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API).

---

## EXPLORE evidence (what the spikes proved)

**Spike 1 — React→HTML render outside a browser (decides renderer placement).**
Ran `react-dom/server.renderToString` in the repo's Node (React 19, ESM):
renders correctly. **Node SSG is feasible.** The component decoupling required is
**bounded and mechanical** (full checklist in §1a). This proves Options A and B
(both Node SSG) and **rejects Option C** (Python prerender): C would need the
*same* decoupling for its hydration React *plus* a parallel Python view layer
duplicating every component's markup → permanent double-maintenance + hydration
mismatch surface, for no gain.

**Spike 2 — browser-support facts (desk-verified, June 2026).** See §0 table.
The Safari/Speculation-Rules gap is real and confirmed; the iOS View-Transitions
floor is **18.4** (confirm exact build on a device).

**Spike 3 — time-relative rendering hazard (found while wiring SSG data).**
`transformResponse` (`src/utils.ts`) computes `dayOffset`, "Today/Tonight"
labels, and **past-showtime filtering** against `new Date()` at view time. If
SSG bakes those at 12h render time, they go stale by up to 12h (a showtime that
passes mid-window would still render as upcoming; day labels drift). **Mitigation
baked into the spec:** SSG bakes **absolute data + static chrome**; all
time-relative computation stays **client-side on hydrate** (§2).

**Not validatable in-repo (deferred to device pass, §6):** the actual feel of
View Transitions, bfcache restore, iOS body-scroll/pull-to-refresh, dark-mode
FOUC. Code can be written from this spec; the *feel* must be confirmed on a real
iPhone.

---

## 1. Target page architecture

Two document types, real URLs, **no client router**:

- `/` → the list (renders today's `MainList`).
- `/film/<id>` → one film detail (renders today's `FilmDetail`).

Each is its own HTML document; list↔detail is a **real browser navigation**
(full load/unload) — this is what unlocks bfcache, native back/forward,
swipe-back, and automatic scroll restoration.

**Render strategy: SSG (pre-rendered HTML) regenerated on the existing 12h
refresh**, with a hydrating JS bundle for interactivity. First paint shows real
content with zero fetch round-trip → satisfies "no white flash" on Safari.
Rejected: static-shell-+-client-fetch (visible flash on Safari forward nav);
per-request Flask SSR (wrong cache shape for timer-changed data).

### 1a. Renderer placement — DECIDED: **Option A** (Node SSG Lambda)

Spike 1 settled the technical question; A vs B is operational:

- **Option A — Node SSG as a second Lambda, chained after the Python refresh
  (CHOSEN).** Python `force_refresh` writes `listings.json`, then triggers a Node
  Lambda that reads it, renders all pages (Vite SSR build), writes HTML+JSON to
  FrontendBucket, invalidates CloudFront. Keeps the EventBridge schedule as the
  **single cadence source**, preserves the existing observability/alerting, keeps
  **all** view logic in the React components (no duplication, honors the recent
  redesign), no paid-tier AWS. New **function**, not a new Python package dir — so
  the `makefile` `cp -r` constraint (CLAUDE.md) does not apply to it; only a new
  top-level *Python* package dir would need a `cp -r` line.
- **Option B — scheduled CI rebuild (DOCUMENTED FALLBACK).** GitHub Actions cron
  (12h) runs pipeline → SSG → `s3 sync` → invalidate; refresh Lambda removed.
  Simplest mental model but puts AWS deploy creds in CI and loses AWS-native
  refresh alerting. Fall back to B only if A's two-runtime packaging proves
  painful in BUILD.
- **Option C — Python prerender + hydration. REJECTED** (Spike 1).

### 1b. Decoupling checklist (mechanical — for the BUILD agent)

SSG requires the components render without a browser and without react-router.
The full, bounded list (everything else is inside `useEffect`, which does not run
during `renderToString`, and much of it is deleted per §4):

1. **`src/context/ThemeContext.tsx:15-23`** — `useState` initializer reads
   `localStorage`/`matchMedia` at render. Guard with `typeof window === "undefined"`
   (server returns a default; client reads real value on hydrate). Pair with the
   inline pre-paint script (§3) so there's no FOUC.
2. **`src/views/MainList.tsx:54`** — `warmAnim` `useState` reads `sessionStorage`
   at render. Guard for server.
3. **`src/components/FilmCard.tsx` + `src/components/CinemaGroup.tsx`** — replace
   `<Link to=…>` + `useLocation` with a plain `<a href={`/film/${id}${search}`}>`.
   On client read `window.location.search`; on server pass current search via prop.
4. **`src/views/MainList.tsx` + `src/views/FilmDetail.tsx`** — replace
   `useSearchParams` with `URLSearchParams(window.location.search)` reads +
   `history.replaceState` writes (a tiny `useUrlParam` hook). Server seeds from the
   page URL.
5. **`src/main.tsx:9`** — delete `history.scrollRestoration = "manual"`. This line
   literally fights the browser restoration we now want.
6. Two client entry points replace the single `App`: `mount-list.tsx` →
   `hydrateRoot(MainList)`, `mount-detail.tsx` → `hydrateRoot(FilmDetail)`.

---

## 2. Data flow

**Source of truth unchanged.** The Python pipeline still scrapes + enriches +
writes `listings.json` on the 12h EventBridge schedule. Only what happens *after*
the write changes.

**On each refresh, the Node renderer (Option A) emits to FrontendBucket** (served
by CloudFront, no Lambda on the read path):
- `index.html` — pre-rendered list, with its data embedded.
- `film/<id>.html` — one pre-rendered page per film, data embedded. (Per-film
  files, not a shared shell — true SSG content is required for the Safari
  forward-nav guarantee and for SEO.)
- `data/listings.json`, `data/film/<id>.json` — the embedded payloads, also
  fetchable for client hydration / Chromium prerender.

This **eliminates `GET /api/listings`** as a runtime endpoint; the Lambda becomes
a **headless scheduled generator** with no public HTTP surface.

**Time-relative split (Spike 3 — important).** SSG bakes only **absolute** data
(ISO dates, theater data, movie metadata) + static chrome. All **time-relative**
UI is computed **client-side on hydrate**: `dayOffset`, "Today/Tonight/Tomorrow"
labels, past-showtime filtering, "updated Xh ago". The server may render a
best-effort snapshot (relative to render time) for first paint, but the client
recomputes on hydrate so a film never shows a screening that has already passed.
Render the genuinely time-sensitive numerals (e.g. the freshness age) **client-
only** to avoid hydration mismatch.

**12h refresh + stale-while-revalidate survival:**
- *Cadence:* unchanged — EventBridge 12h → pipeline → regenerate site →
  CloudFront invalidation (reuse `pipeline._invalidate_cloudfront` /
  `_prewarm_cloudfront`; repoint paths from `/api/listings` to the HTML/data
  paths or `/*`).
- *Stale flag:* embedded payload carries `generated_at`; staleness derived from
  its age vs TTL, client-side (today's `formatDataAge`). A **failed** refresh
  simply doesn't regenerate the site → old content keeps serving and the
  age-based "may be out of date" banner appears naturally. Reproduces today's
  stale semantics without a runtime API stale flag.
- *Instant repeat paint:* content is in the HTML + at the edge; bfcache covers
  back-nav. The `localStorage` blob cache is dropped (§4).

---

## 3. Feel / UX parity

- **Back / swipe-back / scroll restoration:** free via real navigations +
  bfcache. Needs **no code** — needs the *removal* of code fighting it (§4).
  Keep pages bfcache-eligible: no `unload` handlers, no `Cache-Control: no-store`.
- **Forward (list→detail):** cross-document **View Transitions** for a
  poster→backdrop morph (matching `view-transition-name` on tapped poster +
  detail backdrop/poster; `@view-transition { navigation: auto }`). On iOS 18.4+
  the morph plays over already-painted SSG content; below 18.4 it's a plain (but
  flash-free, because SSG) nav. On Chromium, add Speculation Rules `prerender` on
  tap-intent as pure progressive enhancement (no-op on Safari).
- **State across navigations:**

| State | MPA approach |
|---|---|
| Dark mode (`localStorage["btw-dark"]`) | Keep storage. **Add an inline `<head>` script** that sets the `dark` class + `theme-color` **before first paint** on every page — prevents a light→dark flash on cross-document loads (a new risk the SPA didn't have). |
| `?q=` search, `?day=` filter, `?view=cinema` | Stay in URL; survive back-nav natively; `?day=` carried into `/film/<id>?day=` via the link href (as today). |
| "Near me" geolocation | Permission persists at browser level. Re-query `navigator.permissions` per page; auto-activate **only** if already `granted` (never prompt uninvited — preserves today's `App.tsx` behavior). Coords recomputed per page; acceptable (distance labels are nice-to-have). |

---

## 4. What gets deleted (delete, don't deprecate)

- **`react-router-dom`** entirely (dependency removed): `BrowserRouter`,
  `useLocation`, `useNavigate`, `useSearchParams`, `Link`.
- **SPA shell** `src/App.tsx`: screen-switching, shared single fetch,
  `movies.find(id)`, unknown-path redirect, shared title juggling.
- **Manual scroll save/restore:** `MainList.tsx` `SCROLL_KEY` effect (rAF retry
  loop, `restoring` guard, continuous sessionStorage writes) + `FilmDetail.tsx`
  `window.scrollTo(0,0)` on mount + `main.tsx` `scrollRestoration = "manual"`.
- **Manual history handling:** the `onBack` `navigate(-1)` vs `navigate("/")`
  `location.key` dance → plain `<a>` / browser back.
- **localStorage blob cache** (`readListingsCache`, `LISTINGS_CACHE_KEY`).
- **Backend public read surface:** `GET /api/listings` route + transform call
  site; `/api/cinemas` (verify no consumer — theaters are already embedded in the
  listings payload; bake into JSON and drop); the `before_request` origin-verify
  gate *iff* no `/api/*` remains; `spa_fallback`; the CloudFront `/api/listings`
  behavior + `ListingsCachePolicy`.
- **`CustomErrorResponses` 403/404→index.html** SPA fallback (wrong for real
  per-film files — replaced per §5).

**Stays:** all view components, `utils.ts` transforms, `ThemeContext`; the entire
Python pipeline/providers/enricher/cache; EventBridge schedule;
observability/alerting; the document-body-scroll CSS (`min-height:100dvh`, no
inner overflow — preserve exactly).

---

## 5. Build / deploy impact

- **`npm run build`:** add a Vite **SSR/SSG** build producing the renderer + the
  per-page hydration entries (`mount-list`, `mount-detail`). Static assets +
  shells still land in `static/`; per-film HTML is emitted by the Node renderer at
  refresh time from live data (Option A).
- **`template.yaml`:**
  - Add the **Node SSG Lambda** + its build; chain it off the refresh (same
    EventBridge path or post-refresh invoke). New function ≠ new Python package
    dir → `cp -r` makefile constraint N/A.
  - Remove `HttpApi` event + `/api/listings` cache behavior + `ListingsCachePolicy`
    + origin-verify custom header **iff** the public API is fully retired.
  - Replace `CustomErrorResponses` SPA fallback with a **CloudFront Function**
    (viewer-request) rewriting `/film/<id>` → `/film/<id>.html` and `/` →
    `/index.html`; real 404 for missing films. CloudFront Functions are
    free-tier (not Lambda@Edge) → honors no-paid-tier constraint.
  - **Keep:** EventBridge schedule, warmup ping (constraint), alarms, OAC,
    security headers, immutable asset caching.
- **`deploy.sh`:** still build frontend + `s3 sync` + invalidate + warmup ping
  (warmup stays — constraint). Add SSG-Lambda packaging. No post-deploy
  `force_refresh` (constraint); regeneration is the scheduled path.
- **Clean URLs** `/film/<id>` (no `.html`) via the CloudFront Function rewrite.

---

## 6. Risks, SEO, acceptance criteria

### Remaining real-device checks (BUILD agent / owner MUST do — not in-repo)
1. Cross-document View Transition morph fires on iOS 18.4+; graceful plain nav
   below. Confirm exact floor on a device.
2. bfcache restores back-nav instantly with scroll pixel-exact; no
   `unload`/`no-store` regression.
3. Body-scroll + iOS behaviors (`min-height:100dvh`, pull-to-refresh, URL-bar
   collapse) unchanged under the per-document model.
4. Dark-mode inline pre-paint script kills the light→dark FOUC across navs.
5. No hydration-mismatch warnings from the time-relative split (§2).

### SEO
SSG is a strict win: real per-film HTML, unique `<title>`/`<meta>`, per-film
OpenGraph (poster as `og:image`) for shareable links, crawlable. Today's SPA
serves an empty shell. Secondary to navigation, but low-effort upside.

### Acceptance criteria ("feels native")
- Back restores list scroll **pixel-exact**, no jump (bfcache, on iOS Safari).
- iOS **swipe-back animates** natively, no JS interception.
- **Deep links** `/film/<id>` load directly with full SSG content, shareable,
  correct `<title>`/OG.
- **No white flash on forward nav** — detail content paints frame 1 (SSG); morph
  on iOS 18.4+ / Chromium; prerender on Chromium.
- **Dark mode: no FOUC** across navigations.
- **State survives**: `?q=`, `?day=`, `?view=`, dark mode, granted geolocation,
  across list↔detail↔back.
- **Stale behavior preserved**: age banner reflects data age; failed refresh
  degrades gracefully (old content keeps serving).

---

## Recommendation (one line)
**Do the refactor.** Two real document types (`/`, `/film/<id>`), **SSG-pre-
rendered on the existing 12h refresh via a Node SSG Lambda (Option A)**, runtime
read API dropped, leaning on bfcache (back) + cross-document View Transitions +
**SSG content** (forward) — because the primary user is on Safari, where
Speculation Rules cannot help and View Transitions only exist on iOS 18.4+.

## BUILD order (suggested, for the handoff agent)
1. Decouple components from react-router + browser-only render-path access
   (§1b) — keep the SPA building throughout.
2. Add Vite SSR build + Node renderer; prove `/` and one `/film/<id>` render with
   embedded data + the time-relative client split (§2).
3. Swap entries to per-page hydration; delete the SPA shell + scroll/history glue
   (§4). Add the dark-mode inline script + View Transitions CSS + Chromium
   Speculation Rules.
4. Wire Option A into `template.yaml`/`deploy.sh`; CloudFront Function for clean
   URLs; retire the public API + SPA fallback.
5. Update tests (Vitest/Playwright), CLAUDE.md, deploy config. Run `npm run
   typecheck/lint/test:run`, `ruff check .`, `mypy`, production `npm run build`.
6. Real iOS Safari pass against §6 device checks + acceptance criteria.
