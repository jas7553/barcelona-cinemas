# Rewrite progress

The orchestrator's state for the `drive-slice` loop (plan §8). Newest entries at the top of each section.

## Status

| Slice | Track | Status | PR |
|---|---|---|---|
| 1 TypeScript foundation + guardrails | — | done | #186 |
| 2 Port the pipeline | data | done | #187 |
| 3 Extend the data | data | not started | |
| 4 Renderer and infrastructure | UI | not started | |
| 5 Visual foundation | UI | not started | |
| 6 Home | — | not started | |
| 7 Film page | — | not started | |
| 8 Cinemas page | — | not started | |
| 9 Checking the build + cleanup | — | not started | |

## Open questions

(none)

## Decided

- **Ended films (2026-11-24; slices 3 and 7).** Kept in the document for 30 days after their last showing. The film page shows the film's details and "No longer showing in Barcelona." with a link home. After 30 days the address 301s home.
- **Film title (2026-11-24; slice 3).** TMDb's English title, falling back to the listed title for unmatched films. No `original_title` field.
- **Real recordings (2026-11-24; slice 3).** `app/pipeline/fixtures/recorded/live-2026-11-24-2303/` holds a full live run: all four sources and TMDb, 101 films, 659 responses, 22 MB. It's untracked so far: slice 3 decides what to commit (likely trimmed, or kept outside git) when it builds the eval sets from it.

## Slice log

(Each slice adds its task breakdown, decisions made without escalation, rejected review findings, and plan changes here.)

### Slice 2: Port the pipeline

Branch `slice/2-pipeline`. Library code under `app/pipeline/`; no Lambda wiring, cache key or schema output (slice 3), so "esbuild via SAM" moves to slice 3 or 4, whichever ships the first TS Lambda.

**Approach.** Parity is checked against **goldens**: a Python script (`tests/parity/golden.py`, deleted in slice 9) replays recorded HTTP through the legacy code with a frozen clock and writes its output as JSON; Vitest replays the same recordings through the TS port and compares, via a projection both sides share. Goldens are committed, so the TS tests don't need Python. Behavior slice 3 replaces (English-only filtering, `language="vo"`, the 7-day window) is ported as a separate, named step per provider so slice 3 can delete it without touching the parsers. Recorded HTTP is a `manifest.json` of `{method, url, status, contentType, file}` with credentials stripped from URLs.

**Tasks**

| # | Task | Role | Runs |
|---|---|---|---|
| T1 | Parity inputs + goldens: extract the Python tests' inline pages and TMDb payloads into recorded fixtures; record Verdi (cartellera, a few film pages, their seat pages) and SensaCine (a subset of theatres × 2 days) live; `tests/parity/golden.py`. Accept: rerun gives byte-identical goldens; no secrets in fixtures; pytest still green. | Mechanical builder | parallel with T2 |
| T2 | Pipeline foundation: internal types, zod for scraped input, injectable fetcher (live + replay from manifest), timeouts and retryable-error classification, registry and alias lookup from `cinemas.json`, common normalizers, `npm run record`; `cheerio` added. Accept: unit tests; `npm run check`. | Subtle builder | parallel with T1 |
| T3a | englishcinemabarcelona + Mooby providers. Accept: golden parity + ported Python test cases. | Mechanical builder | after T1, T2; parallel |
| T3b | Verdi (incl. room lookups) + SensaCine providers. Accept: golden parity + ported Python test cases. | Mechanical builder | after T1, T2; parallel |
| T4 | Reconciliation (title, then imdb stage; showing dedup) + TMDb enrichment (search, ranking, details, TTL reuse, namesake clashes). Accept: golden parity + ported Python test cases. | Subtle builder | after T1, T2; parallel |
| T5 | Collection: providers in parallel, one retry, snapshot fallback ≤24 h without past showings, partial-failure threshold, end-to-end parity; `npm run refresh:local` prints a summary (no S3). | Subtle builder | after T3, T4 |
| T6 | Verify, review, `slice-done`, PR. | Orchestrator | last |

**Decisions (no escalation needed)**
- Parsers keep every showing with the source's raw `labels`; each provider's `legacyEnglishOnly` step (Mooby English audio/subs, Verdi V.O. before sala lookups, SensaCine `original` key only + 7-day window) is what slice 3 deletes.
- Secondary, Verdi and SensaCine call `reconcile` themselves, as Python does; one test projection (`app/pipeline/testing/python.ts`) maps TS output to the Python golden shape and drops only registry-derived `neighborhood`/`address`, `labels`, and the `starts_at` offset (covered by `madrid` tests).
- Python's provider-output validation (`normalize_movies`) is ported as `validate.ts` in `collect.ts`.
- Started-showing removal on fallback compares instants, not wall-clock strings (differs from Python only in the repeated hour when clocks go back).
- `showingStart` drops malformed times Python let through (e.g. "2045" from englishcinemabarcelona).
- Recordings never hold secret config: secret hosts become `*.example.test` stand-ins, credential params are stripped, and `save()` refuses to write if a secret survives; secret providers' logs carry no URL, host or body.
- SensaCine parity on live data runs per version key (renamed to `original`), because the live recording had no `original` key.
- Ported faithfully, flagged for slice 3: a TMDb match overwrites the source's `imdb_id`/`year` even when TMDb has none; no provider sets `year`, so the ±1-year ranking only runs in tests; the enrichment cache index matches titles with `.lower()` rather than the reconcile normalization; Mooby's English test misses "Inglés" (unaccented needle); Verdi derives `subtitle_lang` from dubbed sessions' labels too; a fallback snapshot keeps its original `fetched_at`, so it expires after 24 h even if nothing newer exists.
- **Deferred to slice 3** (Lambda wiring): the egress-IP and host-IP diagnostics for upstream blocking (R5), CloudWatch metrics, and "esbuild via SAM".
- **Rejected:** removing `sameFilm` (dead until ended films are carried, open question 1); checking the `starts_at` offset is Madrid's in `validate.ts` (every provider builds it with `showingStart`, and the v2 schema checks it in slice 3).
- Found: the legacy SensaCine provider sometimes gets no `original` key live (recording 2026-11-24 had none; a later run did). Logged in `BACKLOG.md` for a possible hotfix on `main`.

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
