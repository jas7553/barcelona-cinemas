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

1. **Ended films (slice 1 schema; decide by slice 3).** The brief says "Every film and every cinema has its own address that keeps working". The legacy site kept ended films for 30 days. The `v2` schema now allows a film with no showings, so either answer fits without a schema change. Still open: how long an ended film stays in the document (the pipeline, slice 3) and what its page says (slice 7). **Recommendation:** keep ended films for 30 days, as today. The film page then shows the film details and one plain line, "No longer showing in Barcelona.", with a link home. After 30 days the address 301s home rather than 404ing.
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
- Review round 1 (independent reviewer): fixed `cinemaDay` moving to `shared` (pipeline needs it), `published_through` ≥ latest showing day, Vitest in a far-off TZ, `.test.tsx` included, time-ban holes, client import allowlist, a self-test for every depcruise rule, Stylelint sibling/`text-shadow`/system-color holes, sideways scroll banned outright, the ↗ check accepting an icon marker, the no-JS check picking the time link, no retries masking flaky layout, Catalan l·l allowed, film text exempt from the clock check, a visible-focus check, and `esbuild`/`cheerio` removed until used.
- **"esbuild via SAM" deferred** to the first TypeScript Lambda (slice 2's refresh or slice 4's renderer). No function exists to build yet, and adding one to `template.yaml` now would be scope creep.
- Review round 2 (re-review of the fixes): fixed inline `import { type X }` still loading the schema at runtime (`no-import-type-side-effects`), and system colors in custom properties, `text-emphasis` and `-webkit-text-stroke`.
- **Rejected in round 2:** (C) `format(undefined)` still reads the clock: lint syntax can't tell an undefined argument from a date, and zero-argument calls are banned. (D) the focus ring's color must be Ink: deferred to slice 5, which defines the tokens; the check then compares with `--ink`. (E) no bad page for focus.ts's "never reached" branch: every good page already has to reach every element, so a reach bug that drops elements fails there.
- **Rejected review findings:** (N7) one source for the CSP string: the stub's CSP is a stand-in and slice 4 replaces it with the renderer's; the e2e CSP check already requires a strict policy on every response. (N8) aria snapshots and the keyboard walk for specific structures: plan §7.2 ties them to the filter sentence and showtimes, which arrive in slices 6–7; a generic visible-focus check lands now. (N9) guardrail self-tests writing temp files into `app/<layer>/`: type-aware ESLint needs them inside a tsconfig project; they're uniquely named and removed in `finally`.
- Left for later slices: slugs for all-digit or non-Latin titles (slice 3, since the schema rejects all-digit slugs); the footer's "Updated" time should come from the latest `checked_at`, not `generated_at` (slice 5).
