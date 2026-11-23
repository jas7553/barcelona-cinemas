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

None.

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
