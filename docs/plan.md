# Barcelona This Week: redesign plan

Nov 23, 2026 · for `docs/brief.md` (the brief) and `docs/mocks/`

The work happens on the `redesign` branch. Each slice is one PR into `redesign`; the switch-over is a single merge to `main` and an in-place deploy. Where this plan and the brief disagree, the brief wins, except for the decisions recorded in §3, which you made after reviewing the brief. Numbers marked *live* come from production's `data/listings.json` at 2026-11-22 16:00 UTC: 41 films, 20 cinemas, 466 showings.

---

## 1. Inventory (today)

**Refresh (Python Lambda, 05:00 and 17:00 Madrid).** `app.py` → `pipeline.force_refresh()` → `refresh.build_listings()`.

Four providers:
- **englishcinemabarcelona**: English showings only
- **Mooby `window.shops`**: has booking URLs and audio/subtitle labels
- **Verdi film pages**: plus admit-one seat pages to tell Verdi from Verdi Park
- **SensaCine**: one page per cinema per day, 7 days ahead

Each provider is retried once, then falls back to its last good snapshot (up to 24 hours old). **Every provider drops dubbed and non-English showings at the source** and hard-codes `language="vo"`.

After collection:
1. Reconcile by title.
2. TMDb enrichment, cached for 7 days.
3. Reconcile again by `imdb_id`.
4. Drop non-English films (`_filter_english`).
5. Keep ended films for 30 days.

The result goes to the cache (versioned S3), then `transform.py` publishes `data/listings.json` and invokes the render.

**Render (Node `SsgFunction`).** Preact SSR of about 400 static pages: week, days, films (undated and dated), cinemas (undated and dated), Cinemas, Privacy, 404. Pages are hydrated in the browser from an embedded JSON payload. Time-relative and preference-driven UI is corrected after mount, with pre-paint inline scripts (CSP-hashed) trying to make server and client agree. Then S3 prune and a CloudFront invalidation.

**Deploy.** One SAM stack:
- S3 behind CloudFront (OAC)
- a CloudFront Function for clean URLs
- a CSP headers policy
- SNS alarms

`deploy.sh` runs six steps, ending with a required forced refresh. You run it; this session's AWS role is read-only. CI covers ruff, mypy, cfn-lint, pytest, tsc, eslint, vitest and Playwright on Linux.

**Why the old site jumped on Back and reload.** Every page painted HTML from the last refresh (up to 12 hours old), then re-rendered after mount with the live clock (`useNow`) and stored preferences (`usePrefs`). Started showings dropped out, rows regrouped, seen films moved. Safari restored the scroll position before those changes, so content above the viewport changed height. The cause is "render stale on the server, correct in the browser", not Preact. PR #154 removed the other causes (sticky bars, view transitions, `viewport-fit=cover`). The new architecture removes this one.

## 2. Gap map

| Brief section | Verdict | Why |
|---|---|---|
| Guiding and design principles | Replace (UI) | Poster grid, octagon, chain icons; nothing visual carries over. |
| Every page | Replace | New header and footer. Addresses: `/film/<id>/` kept, `/cinemas/#<id>` for cinemas, legacy URLs redirected. The age banner is replaced by the stale rule. |
| Home, Film, Cinemas, About, Privacy | Replace | New pages. Only the cinemas map projection and label placement (`src/domain/map.ts`, unit-tested) and the TMDb/JSON-LD details are worth porting. |
| Don't build | Remove | Home location, distances, favourites, the ticket sheet, and the per-day and per-cinema pages all go. |
| Visual system | Replace | Tokens, Newsreader and Schibsted Grotesk (self-hosted subsets, metric-matched fallbacks), icons. |
| Data rules | Change (big) | See below. |
| States and edge cases | New | Each state becomes a tested rule. |
| Checking the build | Change | The Playwright harness and fixture approach are kept. Screenshots, axe, budgets, LCP and the no-mutation test are added. |

**Data gaps.**

| Gap | Today | Needed |
|---|---|---|
| **Dubbed showings** | Dropped by every provider and by `_filter_english`. | Collect every showing in any language. Exclude non-film events using the sources' own flags. |
| **Version label on every showing** | `language` exists but is always `"vo"` and isn't published. | `version: original \| dubbed` from each source. `audio: en \| other \| unknown`, from the source, falling back to TMDb `original_lang`. A showing whose version is unknown is dropped and counted. |
| **Published-through** | Doesn't exist. The last English showing we see isn't a substitute (*live* Zumzeig and Filmoteca each show only one). | Per cinema: the latest date with any showing, from full-programme sources. It's **exact** for cinemas on SensaCine, Mooby or Verdi, and a **lower bound** for La Maquinista and Filmoteca, which are English-feed only. Plus `checked_at` (when any of the cinema's sources last answered). SensaCine fetches until two empty days in a row, up to 21 days ahead. |
| **Maps place refs** | Google search-query URLs. | A hand-curated Google `place_id` per cinema, with keyless Maps URLs for the place and for directions. |
| **Stable film IDs** | TMDb ID, else a title slug, which changes when the film is matched or renamed. | Keep TMDb ID, else slug, but record `previous_ids` when an ID changes. Old URLs 301 to the current one, and seen entries migrate. |
| **New film fields** | Have: year, runtime, genres, rating, tagline, director, cast, synopsis, trailer, imdb_id. | Add `popularity` (refreshed daily) and publish `vote_count` for the weighted rating. Letterboxd links by TMDb ID. |
| **Cinema fields** | Have: name, short_name, neighborhood, website, lat/lng. | Add `chain`, `code`, `description`, `place`. Neighborhoods use local names (Gòtic). Remove Filmax (outside the city, English-only coverage) and Méliès (no source lists it). Draft in Appendix A. |

## 3. Approach

### Decisions

| # | Decision | Chosen | Why, in one line |
|---|---|---|---|
| 1 | What the site publishes | Every film in any language; default view = English OV | The brief, read literally. Payload and matching costs are accepted. |
| 2 | Published-through for English-feed-only cinemas | Lower bound for Last chance; ignored for the day note | A lower bound can only withhold Last chance, never grant it wrongly. |
| 3 | Stale data | Hide a cinema's showings when none of its sources has answered for 36 h. If everything is stale: "Showtimes are taking a break. Check back soon." | Correct or absent, without explaining how data is collected. |
| 4 | Hosting | Per-request SSR on AWS Lambda behind CloudFront | One renderer, real `now` and query at render; no 400-page fan-out. |
| 5 | Languages | TypeScript everywhere | The browser forces JS; one language and one schema for data types. |
| 6 | Refresh | 4 a day: 06:00, 12:00, 17:00, 22:00 Madrid | New days appear within ~6 h; polite to the upstream sites. |
| 7 | Templating | Server-only JSX via `preact-render-to-string` | Typed and auto-escaping; no client framework at all. |
| 8 | Filter changes | Swap the results in place + `replaceState`; `<noscript>` submit button | Keeps focus (WCAG 3.2.2); Back leaves the page; one renderer. |
| 9 | After-midnight showings | The cinema day ends 06:00. Showings go in the previous day's Late column, sorted last, marked "after midnight" | Matches the Afternoon/Evening/Late model; never misread. |
| 10 | Default "in English" | Original version + English audio. Subtitled foreign films only under "all showings" | Matches the brief; subtitle data is patchy. |
| 11 | Maps | Google Maps | Your choice. |
| 12 | Filmax | Dropped | Outside the city, poorly covered, would force a 7th icon. |
| 13 | Partly published day note | All cinemas count; wording "More showings may be added" | A film can open somewhere new; the brief's wording can promise falsely. |
| 14 | Events and unmatched titles | Films only (events excluded via source flags); unmatched films listed with a placeholder | "Every film", not every ticketed item. |
| 15 | Cutover | In place, same stack and URL | Your choice. Mitigated below. |

### Architecture

**Refresh (TypeScript Lambda, 4× a day).**
1. Fetch all four providers, with retry and snapshot fallback as today.
2. Reconcile, enrich, reconcile.
3. Compute versions, audio, published-through and `checked_at`, exclude events, and apply ID aliases.
4. Validate with zod and write **one data document** to a **new cache key** (`v2/listings.json`).

There's no publish or render step. Enrichment is capped per run so a cold cache converges over a few runs, and it is seeded once from the Python cache, read-only.

**Render (TypeScript Lambda behind CloudFront).**
- Loads the document at start and re-reads it after 60 s.
- Routes `/`, `/film/<id>/`, `/cinemas/`, `/about/`, `/privacy/`, and redirects, then renders JSX to HTML with the real `now` (Madrid time) and the query string.
- CloudFront caches each URL for 60 s, serves a stale copy for up to a day if the renderer errors, and serves static assets (CSS, fonts, icons, the client script) from S3 with year-long immutable caching.
- A scheduled ping keeps the renderer warm. CSP comes from the existing headers policy.

**Browser.** A few kilobytes of plain TypeScript, no framework:
- the seen toggle (`localStorage`, key `btw-seen` kept so existing seen films carry over)
- the filter swap
- one pre-paint inline script, CSP-hashed: it fades seen films and, when "hiding films I've seen" is on, hides them and fixes the count before first paint

**The rule:** after first paint, the DOM changes only in direct response to a tap. An e2e test enforces it by failing on any DOM mutation or layout shift between navigation and 2 s after load, on reload and on Back with bfcache disabled, in WebKit at phone width.

**Strong typing.**
- **Strictest compiler settings:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, typescript-eslint `strict-type-checked`.
- **zod at every boundary:** scraped pages, TMDb, the stored document.
- **Toolchain:** Node 22, npm, Vitest, ESLint and Prettier, Playwright, cheerio, esbuild via SAM.
- **Guardrail:** a lint rule bans Preact imports outside the server bundle.

**URLs.**

| Path | Behavior |
|---|---|
| `/?lang=all&date=…&genre=…&sort=popular&seen=hide` | Home; defaults are omitted from the query |
| `/film/<id>/` | Film page; carries `?lang=all` when that's set |
| `/cinemas/`, `/cinemas/#<id>` | Cinemas page; each cinema's address is its anchor |
| `/about/`, `/privacy/` | About, Privacy |
| `/day/<date>/` | 301 → `/?date=<date>` |
| `/film/<id>/<date>/` | 301 → `/film/<id>/` |
| `/cinema/<id>/…` | 301 → `/cinemas/#<id>` |
| an old film ID | 301 → its current ID |

**What stays:** AWS, SAM, CloudFront, S3, SNS alarms (retuned: counts jump with every language collected), SSM secrets, `deploy.sh`'s shape, the forced refresh at the end of a deploy. **What goes:** the static site generation and its render Lambda, the prune, invalidations, hydration, Python.

## 4. Slices

Each slice is a PR into `redesign`, merged when CI is green. Screenshots come from `npm run shots`: Playwright against a date-shifted fixture at **phone 390×844, iPad portrait 820×1180, iPad landscape 1180×820, desktop 1440×900 and large monitor 2560×1440**. They're attached to the PR. Anything layout-related also gets a real Safari pass (Safari MCP), and font and layout-shift checks run on Linux in CI.

| # | Slice | Brief sections | Checked by |
|---|---|---|---|
| 1 | **TypeScript foundation + guardrails.** Repo layout (pipeline, render, client, shared), strict config, zod schemas as the single source of data types, Vitest, esbuild via SAM, CI. All of §7.1's static checks, the Playwright harness with the §7.2 page assertions wired up (they run against a stub page), `slice-done` finalized (drafted in `.claude/skills/slice-done/`; command names confirmed and the skill tested on this slice's own PR). Python untouched. | — | CI green; each guardrail shown failing on a deliberate violation once |
| 2 | **Port the pipeline.** Providers, reconciliation and TMDb enrichment in TS. | — | **Output parity with Python** on recorded source and TMDb fixtures, for behavior that survives: parsing, booking URLs, Verdi room lookups, merging, TMDb matching |
| 3 | **Extend the data.** All languages; version and audio; English test; event exclusion; published-through (exact or lower bound) and `checked_at`; 21-day window; popularity and vote count; ID aliases; registry fields and Google place IDs; Filmax and Méliès removed; enrichment cap and seeding; `v2` cache key. Alarms retuned. The labeled eval sets (§7.3) and the every-state fixture. A local `fix-listing` skill (trace a wrong listing to its source and stage, add it to the eval set first, fix, re-run the evals). | What's listed, Published through, Language filter, Sort data, Seen IDs, Cinema data | Unit test per rule. A timed local refresh against real sources (refresh time vs Lambda timeout, TMDb calls, films and showings by version, events excluded). Diff of the English OV set against live. |
| 4 | **Renderer and infrastructure.** Handler, router, data loading, CloudFront → Lambda origin (OAC), 60 s cache and serve-stale-on-error, assets origin, CSP, keep-warm ping, redirects, 404, `deploy.sh`; `SsgFunction` removed. Pages bare. | Every page (addresses), Page not found | Local handler e2e, cfn-lint, a redirect table test |
| 5 | **Visual foundation.** Tokens, fonts and fallbacks, header, footer, octagon, chain and line icons, buttons, focus. About and Privacy pages. | Every page, About, Privacy, Visual system | Screenshots; axe; contrast unit test against the brief's figures; font swap with no shift on Linux; icon sheet under simulated color blindness vs `color-system.png` |
| 6 | **Home.** Server-side filters and sentence; results swapped in place; three sections and notes; relevance blend tuned against real data (a script prints the ranking); seen toggle, fade and hide; every empty, stale and late-night state; no-JS form. | Home, Data rules (sections, sorts, filters, dates, seen, stale), States | Domain unit tests per rule; no-mutation/no-shift e2e; filters survive Back, reload and a shared link; focus stays on the picker; no-JS e2e; screenshots per state |
| 7 | **Film page.** Layout (side column only when the main column gets ≥600 px); day × Afternoon/Evening/Late grid with empty columns dropped; after-midnight marker; showing line; Google Maps links; site-only ↗; "Showing at" filter by chain; language-hiding note and link; "More showings may be added". | Film page, Time of day, Booking link, Today's past showings, Many cinemas, Partly published days | Domain tests (16:59, 17:00, 20:59, 21:00, 00:30, 05:59 boundaries); e2e for the filter and accessible names; screenshots incl. a 15-cinema film |
| 8 | **Cinemas page.** Lead line; map with icon pins linking to entries; name list; chain groups; entries with Directions, Website and posters; "English showings only" note for La Maquinista and Filmoteca. | Cinemas page | Map placement tests ported; e2e for anchors and legacy redirects; screenshots |
| 9 | **Checking the build + cleanup.** Brief checklist; page budgets in CI; LCP on a mid-range-phone 4G profile; WCAG 2.2 AA (axe + keyboard + VoiceOver). Delete Python and the old front end. Rewrite `CLAUDE.md`, `CONTEXT.md`, README. | Checking the build | A checklist in the PR, each rule linked to its test or screenshot |

## 5. Cutover

1. Merge `main` into `redesign` (no force-push). CI is green.
2. Locally: run a full refresh against real sources, run the renderer, and walk every page in Safari at phone, iPad and desktop widths.
3. Tag `main` as `pre-redesign`.
4. Merge the `redesign` PR into `main` with a **merge commit** (each slice stays its own commit; rollback is `git revert -m 1`).
5. **You run `./deploy.sh`.** The stack updates in place, and the forced refresh writes `v2/listings.json`.
6. Verify with read-only checks:
   - stack status
   - `/`, a film, `/cinemas/`, `/about/`, `/privacy/`, 404, and each legacy redirect
   - no CSP errors in Safari
   - refresh duration and provider outcomes in the logs
7. Watch the next two scheduled refreshes and the alarms. Lambda-IP blocking can only show up here.

**Rollback.** Deploy the `pre-redesign` tag. The old cache key was never written by the new code, so the old pipeline resumes from its own data with no restore. Expect about 10–15 minutes, mostly the CloudFront update.

## 6. Risks and open questions

**Risks**
- **R1 The port breaks a hard-won quirk.** Mitigated by parity tests on recorded fixtures (slice 2) before any behavior changes.
- **R2 Refresh duration.** Every language × 21 days means more SensaCine pages, more Verdi room lookups and many more TMDb calls. Measured in slice 3; the levers are concurrency limits, the enrichment cap, and the Lambda timeout.
- **R3 TMDb matching for Spanish and Catalan titles.** Weaker than for English. Unmatched films are listed with a placeholder rather than a guessed match.
- **R4 Event flags.** Whether SensaCine and Mooby flag events reliably is unverified. If not, a keyword fallback with tests, checked against real data.
- **R5 Upstream blocking.** Doubling the refresh frequency raises the chance that the Verdi/Mooby host blocks Lambda IPs. It's only visible in production; snapshot fallback and SensaCine's overlapping coverage soften it.
- **R6 In-place cutover.** No validation against real sources from AWS before going live. Mitigated by the local run, the separate cache key, and a fast tag rollback.

**Open questions:** none blocking. Deferred on purpose, because each is cheap to change later:
- **Relevance blend weights:** tuned in slice 6 against real listings; they're constants.
- **Registry facts marked †** (Appendix A): data in `cinemas.json`; fix anytime.
- **Event detection details (R4):** settled by what the real data shows in slice 3.

## 7. Guardrails

The aim: every brief rule that can be checked by a machine is, and fails the build when broken. The rest gets a named human or agent check at a fixed point. Most of this lands in slice 1 (tooling) and slice 5 (page checks), before there's much code to retrofit.

### 7.1 Static checks (every commit, pre-commit + CI)

| Check | Enforces |
|---|---|
| `tsc` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | Strong typing |
| typescript-eslint `strict-type-checked`; ban `any`, type assertions (`as`) outside tests, and non-null `!` | No escape hatches from the type system |
| zod at every boundary (scraped pages, TMDb, stored document, query string) | Untrusted input is typed only after it's validated |
| **dependency-cruiser** layer rules: `domain` is pure (no I/O, no Node APIs, no `Date.now()`/argument-less `new Date()`; time is passed in); `client` can't import `render` or Preact; `pipeline` and `render` share only `shared` | The architecture, as tests: one renderer, no client framework creeping back, deterministic time |
| `eslint-plugin-jsx-a11y` | Accessibility mistakes caught in JSX |
| **Stylelint** with a strict-value rule: color, font-size, spacing and radius must use tokens. Bans: `position: sticky/fixed`, `box-shadow`, gradients, `filter: blur`, `text-overflow: ellipsis`, `!important`; `text-transform: uppercase` only on the label class; `transition`/`animation` only inside `prefers-reduced-motion: no-preference` and only on the seen toggle | The visual system's "these values and nothing else"; "Calm"; no truncation; caps only for labels |
| **knip** | No unused files, exports or dependencies (stops agent leftovers piling up) |
| Prettier | Formatting is never a review topic |
| Existing: cfn-lint, CSP hash drift test | Infrastructure and CSP stay consistent |

### 7.2 Tests (CI, every PR)

**Domain and pipeline (Vitest).**
- Each data rule in the brief gets a table test at its boundaries: 16:59/17:00/20:59/21:00/00:30/05:59; Last chance at exact and lower-bound published-through; the 36 h stale edge; the English test across every version and audio combination.
- **Property tests (fast-check)** for "Correct or absent" invariants that example tests miss:
  - no rendered view ever contains a started showing, a showing from a stale cinema, or an unknown-version showing in the default view
  - Last chance is never granted unless every cinema has published far enough
  - filters only ever remove, never add
  - sorting is total and stable
- Provider parsers run against recorded fixtures, and slice 2 checks parity with Python.

**Rendered output (Playwright against the local renderer on the date-shifted fixture, run in Linux CI).** The fixture is extended in slice 3 to contain every state in the brief's "States and edge cases" table, so every page × state is reachable by URL.
- **HTML conformance:** html-validate (Node-native, fast) on every page × state. In slice 9, a one-off run of the reference validator (vnu, which needs Java).
- **Accessibility:**
  - axe with `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa` on every page × state × width
  - Playwright **aria snapshots** for the structures that matter: the filter sentence, showtime names ("21:30, Mooby Balmes, Friday 28, books online"), section headings
  - a keyboard-only walk (tab order, visible focus, picker focus kept after a filter swap)
- **Brief rules as assertions,** on every page × width:
  - no horizontal overflow
  - every interactive element is ≥44×44 px
  - every external link ends in ↗ except showtimes with a booking page
  - no "·"/"•" separators in rendered text
  - times match `HH:MM` 24-hour
  - only same-origin and `image.tmdb.org` requests
  - zero CSP violations and zero console errors
  - with JS disabled, listings, booking links and the noscript filter form work
- **No jump:**
  - Chromium: zero `layout-shift` entries on load, reload, and Back with bfcache disabled
  - WebKit: the bounding boxes of headings and cards at first paint vs 2 s later must be identical, and a MutationObserver sees no changes without input. WebKit doesn't report layout-shift entries, so CLS can't be measured there.
  - bfcache: Back restores from bfcache (Chromium `notRestoredReasons` empty)
- **Visual regression:** `toHaveScreenshot` at the 5 widths for each page × key state, in the Linux container (fonts are deterministic there). Baselines change only in the PR that intends it, and that PR shows the before/after.
- **Budgets:** gzip sizes per page (HTML ≤ 60 KB, CSS ≤ 15 KB, JS ≤ 20 KB, though it'll be far less) and **Lighthouse CI** with mobile 4G throttling: LCP ≤ 1.5 s, CLS 0, TBT ~0. Lighthouse uses Chrome, so it's a proxy; Safari is covered by manual checks.

**Instead of Storybook:** a dev-only `/__catalog` route renders every component in every state: chain icons, cards with each missing field, long titles, placeholder posters, buttons on and off, every empty-state sentence. It gets screenshots, axe and html-validate like any page. Storybook's value is interactive client components, and we have none; it would add a large dependency to show server-rendered strings.

### 7.3 Evals (repeatable quality measurements, not pass/fail on one example)

| Eval | Set | Gate |
|---|---|---|
| **TMDb matching** | ~120 real listed titles labeled with the right TMDb ID or "no match": English, Spanish, Catalan, remakes, repertory classics, festival films. Recorded TMDb responses, so it runs offline. | **Precision must never drop** (a wrong match is worse than none). Recall is reported. Any change to matching rules shows the diff of which titles changed. |
| **Event exclusion** | ~60 labeled titles (film vs event) from recorded SensaCine/Mooby data | No film excluded; event recall reported |
| **Version and audio labels** | Recorded showings with known truth per source | 100% on the set; an unknown label is dropped, never guessed |
| **Relevance ranking** | A frozen real listings snapshot | Not gated: the ranking printout is attached to any PR that touches weights, for your eye |

The labeled sets are built in slice 3 from real data and grow every time a mismatch is found in production. That's the loop: a bad match becomes a test case before it's fixed.

### 7.4 Agent workflow (how I build each slice)

1. **Before writing HTML, CSS or browser JS:** run `modern-web-guidance` (search, then retrieve) for each pattern touched: native pickers, forms, focus, fonts and CLS, images and LCP, CSP. Each PR includes the skill's "Modern Web Guidance" disclosure, so you can see what shaped the code.
2. **Tests first for rules.** A brief rule's test lands in the same commit as its implementation, never after. Flow and e2e tests ship with the feature, bfcache path included.
3. **Before every commit:** `comment-review` on the diff.
4. **Before opening a PR, a self-review against a fixed checklist** (a small project skill, `slice-done`, local to this repo in `.claude/skills/`, so it costs no context elsewhere). It checks:
   - **Scope:** only this slice's items; anything else goes to `BACKLOG.md`.
   - **Reuse:** no logic duplicated from `domain/` or `shared/`; any new dependency is justified in the PR body; knip clean. This stands in for the "reuse-review" you imagined.
   - **Brief traceability:** each brief rule the slice covers is listed with the test or screenshot that proves it.
   - **Visual:** I look at every screenshot at all 5 widths against the brief, then the mocks (the brief wins).
   - **Decisions:** if any §3 decision turned out wrong, the plan is updated in the same PR and the PR says so.
5. **CI green before "done":** watch `gh pr checks --watch`; a local pass isn't enough.
6. **Real Safari check** (Safari MCP) for slices 5–8: reload and Back on iPhone width, landing at the same scroll position with nothing moving. Playwright's WebKit isn't Safari.
7. **Your review points:** `/simplify` and `/review` are yours to run (they're user-invocable only here). Worth it at slices 2, 6 and 9. Run `/security-review` at slice 4 (new public runtime, CSP, Lambda permissions) and slice 9.
8. **Optional: independent review.** For slices 2, 4 and 6, a fresh-context reviewer agent gets only the brief, the plan and the diff, not my reasoning, and reports where they disagree. I'd only spawn it with your OK, since it costs a cold start each time.

### 7.5 After cutover (production guardrails)

- **A data-diff report each refresh**, logged and metered:
  - films added and removed
  - showings per cinema vs the previous run
  - published-through going *backwards*
  - unmatched titles and event exclusions
- **Alarms:** a cinema losing all showings while its sources answered (parser drift); TMDb precision signals (a film's TMDb ID changing); the renderer's error rate; the 36 h stale rule hiding anything (it should almost never fire).
- **The existing alarms,** retuned for every-language counts.

### 7.6 Explicitly not adding

- **Jest:** Vitest already covers it, and two runners is churn.
- **Storybook:** see above.
- **Mutation testing:** high cost; the property tests and evals target the risky logic directly.
- **Separate staging:** you chose in-place.
- **Pre-commit running e2e:** too slow; CI runs it.

## 8. Build loop

The work is driven one slice at a time by an orchestrator session using the local `drive-slice` skill (`/drive-slice <n>`). The orchestrator runs on Opus with lean context, and its state lives in `docs/progress.md`. It plans each slice into tasks and delegates them to subagents at a model and effort suited to the task (table in the skill):
- **Explore** (Haiku) for mapping code.
- **Sonnet** for mechanical building.
- **Opus** for subtle logic, tests and reviews.

**Safeguards:**
- **One fresh orchestrator per slice.** Nothing depends on a long-lived context.
- **For rule slices, the tests come from a separate test writer** working from the brief, and builders may not edit them.
- **The orchestrator verifies every claim itself:** CI, test output, screenshots.
- **An independent reviewer sees only the brief, the plan and the diff.** For UI slices, a visual reviewer checks every screenshot.
- **At most two fix rounds** before a task is replanned or escalated.

**Tracks:** after slice 1, the data track (2 → 3) and the UI track (4 → 5) run in parallel, in separate worktrees. Slices 6, 7, 8 and 9 follow in sequence.

**Merging:** the orchestrator squash-merges a slice PR into `redesign` once CI is green, the review passed and nothing is escalated. Merging `redesign` into `main` and deploying stay with you.

**Escalation:** only high-judgment decisions reach you: changes to §3, departures from or gaps in the brief, unsettled visual or wording choices, quality trade-offs in an eval gate, significant dependencies, and anything costing money or touching AWS or `main`. Non-blocking questions are batched in `progress.md` and the slice summary. A blocker gets a push notification.

**Slice 1 addition:** make the e2e port configurable, so parallel worktrees don't need the e2e lock.

## Appendix A: cinema registry draft

Neighborhoods use local names at the level people actually say (barri where it's well known, otherwise a landmark or district). Codes are two letters, unique, taken from the venue rather than the chain (the icon shape carries the chain). Descriptions are plain facts, with a dry touch only where the fact allows it.

| Key | Name | Short name | Chain | Code | Neighborhood | Description |
|---|---|---|---|---|---|---|
| Aribau | Mooby Aribau | Aribau | Mooby | Ri | Eixample | Multiplex off Plaça Universitat |
| Arenas | Mooby Arenas | Arenas | Mooby | Ar | Plaça d'Espanya † | Multiplex in the old bullring |
| Balmes | Mooby Balmes | Balmes | Mooby | Ba | Sant Gervasi | Multiplex |
| Bosque | Mooby Bosque | Bosque | Mooby | Bo | Gràcia | Multiplex |
| Glòries | Mooby Glòries | Glòries | Mooby | Gl | Poblenou | Mall multiplex |
| Sarrià | Mooby Sarrià | Sarrià | Mooby | Sa | Sant Gervasi † | Multiplex |
| CinDiag | Cinesa Diagonal | Diagonal | Cinesa | Di | Les Corts † | Multiplex |
| CinDigMar | Cinesa Diagonal Mar | Diagonal Mar | Cinesa | DM | Diagonal Mar | Mall multiplex |
| SOM | Cinesa SOM Multiespai | SOM | Cinesa | SO | Nou Barris | Mall multiplex |
| Maquinista | Yelmo La Maquinista | La Maquinista | Yelmo | Mq | Sant Andreu | Mall multiplex |
| Verdi | Cines Verdi | Verdi | Verdi | Ve | Gràcia | Arthouse, original version since 1987 † |
| VP | Verdi Park | Verdi Park | Verdi | VP | Gràcia | Verdi's sister, around the corner |
| RenFlo | Renoir Floridablanca | Floridablanca | Renoir | Fb | Sant Antoni | Arthouse |
| Malda | Cinema Maldà | Maldà | Independent | Ma | Gòtic | Tiny indie in an old arcade |
| FdC | Filmoteca de Catalunya | Filmoteca | Independent | Fi | El Raval | Catalonia's film archive: seasons and restorations |
| Girona | Cinemes Girona | Girona | Independent | Gi | Eixample | Neighborhood indie |
| EspaiTexas | Espai Texas | Texas | Independent | Tx | Gràcia | Neighborhood cinema and theater † |
| Zumzeig | Zumzeig Cinecooperativa | Zumzeig | Independent | Zu | Hostafrancs | Cooperative indie |
| Phenomena | Phenomena | Phenomena | Independent | Ph | Sagrada Família | Cult films and classics on one big screen |

Changes from today's registry, beyond the new fields:
- **Neighborhoods:** "Gothic Quarter" → Gòtic, "Poble-Nou" → Poblenou, "Porta" → Nou Barris (better known), "Sarrià-Sant Gervasi" → Sant Gervasi, "Dreta de l'Eixample" → Eixample, "Vila de Gràcia" → Gràcia, "Bon Pastor" → Sant Andreu, Mooby Arenas "Eixample" → Plaça d'Espanya.
- **Short names:** Renoir → Floridablanca (the venue, as in the mocks; "Renoir" names the chain), Maquinista → La Maquinista.
- **Names:** "Yelmo Westfield La Maquinista" → Yelmo La Maquinista, "Sala Phenomena Experience" → Phenomena (what people call them).
- **Removed:** Filmax (decision 12), Méliès (no source).

† To check before slice 3 merges:
- Arenas sits on the Eixample/Hostafrancs border; Plaça d'Espanya is the name people use.
- Mooby Sarrià (Ronda del General Mitre) may be Les Tres Torres rather than Sant Gervasi.
- Cinesa Diagonal (Santa Fe de Nou Mèxic) may be Sant Gervasi–Galvany rather than Les Corts.
- Verdi's opening year.
- That Espai Texas still runs theater alongside film.
