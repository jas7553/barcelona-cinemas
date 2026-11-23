# Rewrite progress

The orchestrator's state for the `drive-slice` loop (plan §8). Newest entries at the top of each section.

## Status

| Slice | Track | Status | PR |
|---|---|---|---|
| 1 TypeScript foundation + guardrails | — | in progress (branch `slice/1-foundation`) | |
| 2 Port the pipeline | data | not started | |
| 3 Extend the data | data | not started | |
| 4 Renderer and infrastructure | UI | not started | |
| 5 Visual foundation | UI | not started | |
| 6 Home | — | not started | |
| 7 Film page | — | not started | |
| 8 Cinemas page | — | not started | |
| 9 Checking the build + cleanup | — | not started | |

## Open questions

1. **Films whose showings have all ended (slice 1, affects 3 and 7).** The legacy site kept ended films for 30 days so shared film links kept working. Neither the brief nor the plan says whether the new site does. The `v2` schema requires at least one showing per film, so an ended film's URL gives the 404 page ("one plain sentence, a light touch of humor, and a link home"). Options: (a) keep that; (b) keep ended films in the document for N days and show a "no longer showing" film page. **Recommendation: (a).** The brief lists only what's showing, and the 404 already links home. Allowing (b) later only means relaxing `showings` to `min(0)` plus one page state.
2. **Which title a film shows (slice 3).** Every language is now listed, so a film's `title` could be TMDb's English title or the title the cinema listed (often Spanish or Catalan). **Recommendation:** TMDb's English title, falling back to the listed title for unmatched films. The site is in English, and the old site did the same. No `original_title` field until a page needs one.

## Slice log

(Each slice adds its task breakdown, decisions made without escalation, rejected review findings, and plan changes here.)

### Slice 1: TypeScript foundation + guardrails

Branch `slice/1-foundation`.

**Layout decision:** the new code lives under `app/` (`app/shared`, `app/domain`, `app/pipeline`, `app/render`, `app/client`, `app/e2e`), beside the legacy code until slice 9. One root `package.json`; the new code owns `check`, `test`, `e2e`, `budgets`, `shots`, and the legacy scripts move to `legacy:*`. Prettier and the new linters cover `app/` only. Python, `src/`, `e2e/`, `ssg-lambda/` untouched apart from script renames in CI.

**Tasks**

| # | Task | Role | Runs |
|---|---|---|---|
| T1 | Toolchain: `app/` layout, strict tsconfig, ESLint `strict-type-checked` + bans (`any`, `as` outside tests, `!`, Preact outside `render`, `Date.now()`/bare `new Date()` in `domain`) + jsx-a11y, dependency-cruiser layer rules, knip, Prettier, Vitest, all new deps installed, scripts, CI jobs, pre-commit. Accept: `npm run check` and `npm test` pass on a placeholder per layer; legacy CI jobs still pass. | Mechanical builder | first |
| T2 | Stylelint guardrails (§7.1 row), custom rules where plugins fall short; guardrail self-tests (ESLint, Stylelint, dependency-cruiser fail on inline violations, via their Node APIs). Accept: self-tests in `npm test`. | Subtle builder | after T1, parallel |
| T3 | `v2` document schema (zod, single source of types) + date-shifted fixture generator. Accept: fixture validates for any `now` incl. DST edges; schema covers every brief data field. | Subtle builder | after T1, parallel |
| T4 | Playwright harness for `app/`: configurable port, stub page server with CSP header, §7.2 page assertions as reusable checks at 5 widths, html-validate, axe, CLS/WebKit-scroll/bfcache, `shots`, `budgets`; each assertion shown failing on a bad stub. Accept: `npm run e2e`, `shots`, `budgets` run locally and in the Linux container. | Subtle builder | after T1, parallel |
| T5 | `slice-done` command table confirmed; PR; CI. | Orchestrator | last |

**Decisions (no escalation needed)**
- Schema (`app/shared/listings.ts`): showings nested under films; `starts_at` is ISO-8601 at Madrid's own offset, to the minute, and the cinema day is derived (`cinemaDay()` in `app/domain/madrid-date.ts`, the one copy of the 06:00 rule); missing data is an absent key, never `null` or `[]`; strict objects; posters as TMDb `poster_path`, trailers as YouTube keys; `rating` is `{average, votes}`; `place_id` only, Maps URLs are built in the renderer.
- `published_through` is required for a cinema with showings, and `coverage: full | english_only` says whether it's exact or a lower bound. A cinema with no showings may have none (cold start, empty sources).
- `audio` is the language heard in that showing. The TMDb `original_lang` fallback applies only to original-version showings, never to dubs.
- The document lists every registry cinema, with or without showings (the Cinemas page and the stale rule need them).
- `place_id` is validated as an opaque token (Google says not to rely on the `ChIJ` prefix).
- Left for later slices: slugs for all-digit or non-Latin titles (slice 3, since the schema rejects all-digit slugs); the footer's "Updated" time should come from the latest `checked_at`, not `generated_at` (slice 5).
