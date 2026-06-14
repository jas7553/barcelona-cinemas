# Task: Refactor Barcelona Movie Database from SPA to MPA

You are picking this up cold. Work in phases — SPEC, then EXPLORE, then BUILD —
and STOP for my approval at the end of each phase. Do not write feature code
during SPEC or EXPLORE.

## Why this exists

The app is a React SPA (react-router, client-side routing). Home list and film
detail are two client routes sharing one document/body scroll. Because the list
unmounts when a detail opens, list scroll position must be saved/restored
manually across the shared window — and that glue has been a recurring source of
scroll-restoration and back-button bugs (esp. iOS Safari swipe-back).

The motivating insight: this app is canonical MPA-shaped content — browse a
list, tap a thing, go back. An MPA gets scroll restoration, back/forward, iOS
swipe-back, and bfcache correct *for free* (the exact things that break today),
and with the View Transitions API + Speculation Rules can feel as smooth as the
SPA on forward nav and strictly better on back. Goal: evaluate and, if it holds
up, execute the SPA→MPA refactor.

This is an exploration that may end in "don't do it." If during SPEC/EXPLORE you
find MPA is the wrong call for this codebase, say so with evidence — I'd rather
kill it early than build the wrong thing.

## No users yet — build it clean

The site has zero users. Do NOT build a migration path: no feature flags, no
backward-compat shims, no dual SPA/MPA running side by side, no gradual cutover.
Big-bang replacement is fine and preferred. Delete the SPA code outright once the
MPA replaces it. Keep `main` building, but don't preserve the old architecture
for safety.

## What you must learn first (read these before proposing anything)

- `CLAUDE.md` — full architecture, commands, constraints. Read it completely.
- `src/App.tsx` — current routing, the single shared listings fetch, localStorage
  stale-while-revalidate cache, screen switching.
- `src/views/MainList.tsx` and `src/views/FilmDetail.tsx` — the two "pages" and
  the manual scroll save/restore logic (the thing MPA would delete).
- `src/style.css` — `.screen` / `.detail-screen` use `min-height:100dvh`, no
  inner overflow container; the page scrolls the document body on purpose
  (iOS pull-to-refresh, URL-bar collapse). Preserve this property.
- `app.py`, `transform.py`, `src/utils.ts` (`transformResponse`), `src/types.ts`
  — the API contract.
- `models.py` — `Movie`/`Showtime` shapes; the pipeline already models a single
  film, so per-film data is cheap to produce.

## Data: design it for the MPA, don't inherit the SPA's shape

Current state (context, NOT a constraint): the app ships ALL data in one cached
blob — `GET /api/listings` returns every film + showtime, refreshed server-side
every 12h, served cached-only with a stale flag. The SPA does this so its client
router can `movies.find(m => m.id === …)` with zero per-film fetch. The blob is an
SPA implementation detail.

A from-scratch MPA would give each film its own data source. Treat per-film data
as a thing you DESIGN, not a missing prerequisite. The backend pipeline already
models a single film (`models.py` Movie, `transform.py`), so producing per-film
data is cheap. Pick the right shape for an MPA and weigh it explicitly:

- Build-time static: pre-render one HTML page per film from the dataset →
  pure static on S3/CloudFront, no detail-time API call, perfect for content
  that changes every 12h. Likely the strongest fit — revisit the blob too:
  the home page could also be statically built, dropping the runtime read API.
- Per-film API endpoint (`GET /api/film/<id>`) via existing Flask/Lambda, for
  SSR or client hydration on the detail page.
- Hybrid: static home + on-demand detail.

Whatever you choose, the 12h refresh cadence and stale-while-revalidate behavior
must survive (build-trigger vs request-time caching is yours to decide). Note the
data changes on a timer, not per-request — static site generation re-run on the
12h refresh is the front-runner; it could let you drop the runtime read API
entirely.

## Phase 1 — SPEC (stop for approval)

Produce a written spec covering:
1. Target data + page architecture. Decide among the data options above and the
   page-generation strategy (SSG vs SSR vs hybrid) for content that refreshes
   every 12h. Recommend one, with reasoning.
2. Data flow: where each page's data comes from, how the 12h refresh and the
   stale-while-revalidate behavior survive, build-time vs request-time.
3. Feel/UX parity plan: View Transitions API (cross-document, poster→detail
   morph), Speculation Rules (prerender on tap-intent), bfcache. State that must
   survive a navigation (dark mode, ?q= search, ?day= filter, "Near me"
   geolocation) and how (URL params + localStorage/cookies).
4. What gets deleted: the manual scroll save/restore, manual history handling,
   client router, the SPA shell — enumerate it. Delete, don't deprecate.
5. Build/deploy impact: `npm run build` output, `template.yaml`, `deploy.sh`,
   CloudFront routing/redirects for clean URLs (`/film/<id>`). Honor existing
   constraints in CLAUDE.md (makefile Lambda packaging; new package dirs need a
   cp -r line; no paid-tier AWS features; warmup ping stays).
6. Risks, SEO implications, and explicit acceptance criteria for "feels native":
   scroll restoration exact on back, iOS swipe-back animates, deep links work,
   no white flash on forward nav.

## Phase 2 — EXPLORE (stop for approval)

Validate the spec's risky assumptions with throwaway spikes (don't merge):
- View Transitions cross-document morph on this app's poster/card → detail.
- Speculation Rules prerender feel on mobile.
- The chosen data-flow path proven end to end for ONE film.
- Confirm body-scroll + iOS behaviors (pull-to-refresh, URL bar) still hold.
Report what worked, what didn't, revise the spec, get sign-off before building.

## Phase 3 — BUILD

Implement the approved spec. Match existing code style, comment density, and
idioms. Update tests (Vitest/Playwright), CLAUDE.md, and deploy config. Remove
the dead SPA code. Run: `npm run typecheck`, `npm run lint`, `npm run test:run`,
`ruff check .`, `mypy`, and a production `npm run build` before declaring done.
Verify the acceptance criteria on a real iOS Safari pass.

## Working agreement

- Stop at each phase boundary. No code in Phase 1–2 beyond throwaway spikes.
- Surface a "don't do this" finding the moment you have evidence.
- No migration scaffolding — zero users, big-bang replacement.
- Don't read `.env*` files.
- Don't add Co-Authored-By trailers to commits.
