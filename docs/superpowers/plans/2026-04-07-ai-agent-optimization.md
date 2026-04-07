# AI Agent Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `CLAUDE.md` accurate and agent-efficient by fixing stale content and adding data model, env vars, common task, and anti-pattern sections; then sync `AGENTS.md` to match.

**Architecture:** Two documentation files are modified — `CLAUDE.md` (primary, authoritative) and `AGENTS.md` (Codex mirror). No application code changes. No tests required (markdown edits are verified by reading the result).

**Tech Stack:** Markdown, git

---

### Task 1: Fix CLAUDE.md — architecture diagram and file map

**Files:**
- Modify: `CLAUDE.md`

This task corrects stale content: wrong architecture diagram path, wrong `App.tsx` description, wrong `ShowtimesView.tsx` description, ghost components in the components list, and missing hooks/views entries.

- [ ] **Step 1: Fix the architecture diagram**

In `CLAUDE.md`, find:
```
               ├── scrapers/english_cinema_bcn.py
```
Replace with:
```
               ├── providers/listings_provider.py
```

- [ ] **Step 2: Fix the App.tsx file map entry**

Find the exact line:
```
| `src/App.tsx` | Root component: fetches listings, manages movies/theaters/stale/loading/error state, routes to views. |
```
Replace with:
```
| `src/App.tsx` | Root component: fetches listings, manages state (movies, stale, loading, error). Renders `ShowtimesView` directly — no routing. |
```

- [ ] **Step 3: Fix the ShowtimesView.tsx file map entry**

Find:
```
| `src/views/ShowtimesView.tsx` | Main view: renders full showtimes listing with filter/sort UI. |
```
Replace with:
```
| `src/views/ShowtimesView.tsx` | Main view: film list with smart sort, search, and hidden-film exclusion. |
```

- [ ] **Step 4: Add hooks entries to the file map**

Find the ShowtimesView line (just updated above) and insert two new rows directly after it:
```
| `src/hooks/useGeolocation.ts` | Geolocation request + Haversine distance calculations to each theater. |
| `src/hooks/useHiddenFilms.ts` | localStorage-backed hidden film set (`hidden_film_ids`). |
```

- [ ] **Step 5: Fix the src/components/ file map entry**

Find:
```
| `src/components/` | `DateBar`, `FilterPanel`, `Footer`, `Header`, `MovieList`, `MoviePoster`, `MovieRow`, `Sidebar`, `SortControl`, `TheaterCard`, `TheaterFilterSheet`, `TimeChip`, `TmdbAttribution`, `EmptyState` — all self-contained. |
```
Replace with:
```
| `src/components/` | `EmptyState`, `Footer`, `Header`, `MovieList`, `MoviePoster`, `MovieRow`, `TheaterCard`, `TimeChip`, `TmdbAttribution` — all self-contained. |
```

- [ ] **Step 6: Verify**

Run:
```bash
grep -n "scrapers" CLAUDE.md
```
Expected: no output (the old path is gone).

```bash
grep -n "routes to views\|DateBar\|FilterPanel\|Sidebar\|SortControl\|TheaterFilterSheet" CLAUDE.md
```
Expected: no output.

```bash
grep -n "useGeolocation\|useHiddenFilms" CLAUDE.md
```
Expected: two lines.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: fix stale file map entries in CLAUDE.md"
```

---

### Task 2: Add data models section to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

Agents currently have to open `models.py` and `transform.py` to understand data shapes. This section puts both the internal cache format and the public API response shape directly in `CLAUDE.md`.

- [ ] **Step 1: Insert the data models section**

Find the line `## Commands` in `CLAUDE.md`. Insert the following block **immediately before** it (preserve the `---` separator):

```markdown
## Data models

### Internal (models.py / cache)

```
Listings:   fetched_at (ISO str), stale (bool), movies[]
Movie:      title, tmdb_id, imdb_id, year, poster_url, synopsis,
            rating, runtime_mins, genres[], showtimes[]
Showtime:   cinema (cinemas.json key), neighborhood, address,
            date (YYYY-MM-DD), time (HH:MM), language?
CinemaInfo: id, name, address, neighborhood, website_url,
            maps_url, lat?, lng?, aliases?
```

### Public API (`GET /api/listings` response)

```
{
  generated_at: str (ISO 8601),
  stale: bool,
  theaters[]: { id, name, neighborhood, website_url, maps_url, lat?, lng? },
  movies[]: {
    id: str,
    title: str,
    year: int?,
    runtime_minutes: int?,
    poster_url: str?,
    genres: str[],
    rating: float?,
    synopsis: str,
    links: { imdb: str? },
    showtimes[]: { theater_id, date, time, language }
  }
}
```

> `transform.py` owns this translation. The internal `Showtime.cinema` (a name string matching a `cinemas.json` key) becomes `theater_id` (the cinema's `id` field) in the public shape.

---
```

- [ ] **Step 2: Verify**

```bash
grep -n "Data models\|Public API\|theater_id" CLAUDE.md
```
Expected: three matching lines.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add data models section to CLAUDE.md"
```

---

### Task 3: Add environment variables, common tasks, and anti-patterns to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

Three new sections appended at the end of `CLAUDE.md` after `## Key design constraints`.

- [ ] **Step 1: Add the environment variables section**

Find `## Key design constraints`. Insert the following block **immediately before** it:

```markdown
## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `TMDB_API_KEY` | — | Required |
| `CACHE_BACKEND` | `file` | `file` (dev) or `s3` (prod) |
| `CACHE_TTL_HOURS` | `12` | |
| `CACHE_DIR` | `./cache` | File backend only |
| `S3_BUCKET` | — | S3 backend only |
| `S3_KEY` | `listings.json` | S3 backend only |
| `PORT` | `5000` | Dev server |

---
```

- [ ] **Step 2: Add the common tasks section**

Append the following at the **end of the file**, after the last line of `## Key design constraints`:

```markdown

---

## Common tasks

When making the following types of changes, these are all the files that need to be touched:

| Task | Files |
|---|---|
| Add or rename a data field | `models.py` → `src/types.ts` → `transform.py` (+ `enricher.py` if TMDb-sourced; + `validation.py` if validated at ingest) |
| Add a new cinema | `cinemas.json` only — add `lat`/`lng` if known; the registry is the source of truth |
| Add a new provider | Implement `ListingsSource` protocol → register in `providers/__init__.py` |
| Add a frontend component | `src/components/ComponentName.tsx` + co-located `src/components/ComponentName.test.tsx` |
| Change the API contract | `transform.py` → `src/types.ts` → `src/utils.ts` (`transformResponse`) |

---

## Anti-patterns

- Don't put business logic in `app.py` — HTTP layer only; logic belongs in `pipeline.py` or domain modules.
- Don't reference `FileCache` or `S3Cache` directly — use the `Cache` abstraction; backends are interchangeable.
- Don't raise in `enricher.py` — catch failures, log them, and return the movie with partial data.
- Don't add CloudWatch Dashboards, WAF, or X-Ray to `template.yaml` — these are paid-tier services.
- Don't add Lambda warm-up invocations to `deploy.sh`.
```

- [ ] **Step 3: Verify**

```bash
grep -n "Environment variables\|Common tasks\|Anti-patterns" CLAUDE.md
```
Expected: three matching lines.

```bash
grep -n "TMDB_API_KEY\|Add or rename\|Don't put business" CLAUDE.md
```
Expected: three matching lines.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add env vars, common tasks, and anti-patterns to CLAUDE.md"
```

---

### Task 4: Rewrite AGENTS.md to mirror updated CLAUDE.md

**Files:**
- Modify: `AGENTS.md`

`AGENTS.md` is significantly diverged — it references the old `scrapers/` directory, old component names, and is missing the new sections. Rewrite it to mirror `CLAUDE.md` exactly, with a Codex-appropriate title and a sync note.

- [ ] **Step 1: Overwrite AGENTS.md with the mirrored content**

Replace the entire contents of `AGENTS.md` with:

```markdown
# Barcelona Movie Database — Codex Guide

> Mirrors `CLAUDE.md` — `CLAUDE.md` is the source of truth. Last synced: 2026-04-07.

## What this project is

Full-stack serverless app that scrapes an English-language cinema website in Barcelona, enriches results with TMDb metadata, and serves them via a React SPA. Backend is Flask running on AWS Lambda; frontend is built to S3/CloudFront.

---

## Architecture at a glance

```
React SPA (src/)  →  Flask API (app.py)  →  pipeline.py
                                               ├── providers/listings_provider.py
                                               ├── enricher.py  (TMDb API)
                                               └── cache.py  (file or S3 backend)
```

**Request path:** `GET /api/listings` → `pipeline.get_listings()` → return cached data only; if the cache is older than the TTL, respond with `"stale": true` instead of refreshing in-band.

**Stale fallback:** If the request path encounters an error and any cache exists, stale cache is returned with `"stale": true`; frontend shows a banner.

**Scheduled refresh:** EventBridge fires every 12h → Lambda detects `{"source": "aws.events"}` in `app.py:handler()` → `pipeline.force_refresh()`.

---

## File map — read this before opening files

| File | Purpose |
|---|---|
| `app.py` | Flask routes + Lambda handler. HTTP layer only — no business logic. |
| `pipeline.py` | Orchestration: cache TTL check, scrape, enrich, write cache. |
| `models.py` | All shared TypedDicts (`Movie`, `Showtime`, `Listings`). Read this first when touching data shapes. |
| `cache.py` | `Cache` abstraction with `FileCache` and `S3Cache` backends. Same interface. |
| `enricher.py` | TMDb API calls (search + detail). Never raises; failures log and set fields to `null`. |
| `listings_config.py` | Runtime-resolved config values (env-driven). |
| `observability.py` | Structured logging + EMF metric helpers. |
| `transform.py` | Transforms internal `Listings` → public API shape (called at HTTP boundary in `app.py`). |
| `validation.py` | Validation and normalization for cached/fetched movie data. |
| `providers/__init__.py` | `ListingsSource` protocol + `all_providers` list. Add new providers here. |
| `providers/listings_provider.py` | Primary scraper. Parses the 7-day cinema listings feed. |
| `providers/secondary_provider.py` | Secondary/fallback listings source. |
| `providers/cinema_aliases.py` | Maps scraped cinema names to `cinemas.json` keys. |
| `cinemas.json` | Cinema registry: `{ "short-name": { "name", "address", "neighborhood" } }`. Source of truth for which cinemas are tracked. |
| `src/types.ts` | TypeScript interfaces — mirror of `models.py`. |
| `src/api.ts` | All frontend HTTP calls. Touch this to change API contracts. |
| `src/App.tsx` | Root component: fetches listings, manages state (movies, stale, loading, error). Renders `ShowtimesView` directly — no routing. |
| `src/utils.ts` | `transformResponse` — maps API response to typed frontend models. |
| `src/views/ShowtimesView.tsx` | Main view: film list with smart sort, search, and hidden-film exclusion. |
| `src/hooks/useGeolocation.ts` | Geolocation request + Haversine distance calculations to each theater. |
| `src/hooks/useHiddenFilms.ts` | localStorage-backed hidden film set (`hidden_film_ids`). |
| `src/components/` | `EmptyState`, `Footer`, `Header`, `MovieList`, `MoviePoster`, `MovieRow`, `TheaterCard`, `TimeChip`, `TmdbAttribution` — all self-contained. |
| `template.yaml` | SAM/CloudFormation: Lambda, S3 (cache + frontend), CloudFront, EventBridge. |

---

## Data models

### Internal (models.py / cache)

```
Listings:   fetched_at (ISO str), stale (bool), movies[]
Movie:      title, tmdb_id, imdb_id, year, poster_url, synopsis,
            rating, runtime_mins, genres[], showtimes[]
Showtime:   cinema (cinemas.json key), neighborhood, address,
            date (YYYY-MM-DD), time (HH:MM), language?
CinemaInfo: id, name, address, neighborhood, website_url,
            maps_url, lat?, lng?, aliases?
```

### Public API (`GET /api/listings` response)

```
{
  generated_at: str (ISO 8601),
  stale: bool,
  theaters[]: { id, name, neighborhood, website_url, maps_url, lat?, lng? },
  movies[]: {
    id: str,
    title: str,
    year: int?,
    runtime_minutes: int?,
    poster_url: str?,
    genres: str[],
    rating: float?,
    synopsis: str,
    links: { imdb: str? },
    showtimes[]: { theater_id, date, time, language }
  }
}
```

> `transform.py` owns this translation. The internal `Showtime.cinema` (a name string matching a `cinemas.json` key) becomes `theater_id` (the cinema's `id` field) in the public shape.

---

## Commands

**Backend:**
```bash
python app.py                        # Dev server on :5000
pytest tests/                        # Python tests
ruff check . && ruff format .        # Lint + format
mypy                                 # Type check (strict)
```

**Frontend:**
```bash
npm run dev       # Vite dev server on :5173, proxies /api → :5000
npm run build     # Compile + bundle → static/
npm run typecheck # TS type check only
npm run lint      # ESLint
npm run test:run  # Vitest single run
```

**Deploy:**
```bash
./deploy.sh       # SAM build + deploy to AWS
```

---

## Tests

**Python** (`tests/`): pytest + `unittest.mock`. Each module has its own test file (`test_pipeline.py`, `test_enricher.py`, `test_cache.py`, `test_app.py`, `test_listings_provider.py`, `test_secondary_provider.py`, `test_listings_config.py`, `test_transform.py`, `test_validation.py`, `test_template.py`). Uses `monkeypatch` and `tmp_path` fixtures.

**Frontend** (`src/**/*.test.tsx`): Vitest + Testing Library. Co-located with components. `src/test-setup.ts` imports matchers.

---

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `TMDB_API_KEY` | — | Required |
| `CACHE_BACKEND` | `file` | `file` (dev) or `s3` (prod) |
| `CACHE_TTL_HOURS` | `12` | |
| `CACHE_DIR` | `./cache` | File backend only |
| `S3_BUCKET` | — | S3 backend only |
| `S3_KEY` | `listings.json` | S3 backend only |
| `PORT` | `5000` | Dev server |

---

## Common tasks

When making the following types of changes, these are all the files that need to be touched:

| Task | Files |
|---|---|
| Add or rename a data field | `models.py` → `src/types.ts` → `transform.py` (+ `enricher.py` if TMDb-sourced; + `validation.py` if validated at ingest) |
| Add a new cinema | `cinemas.json` only — add `lat`/`lng` if known; the registry is the source of truth |
| Add a new provider | Implement `ListingsSource` protocol → register in `providers/__init__.py` |
| Add a frontend component | `src/components/ComponentName.tsx` + co-located `src/components/ComponentName.test.tsx` |
| Change the API contract | `transform.py` → `src/types.ts` → `src/utils.ts` (`transformResponse`) |

---

## Key design constraints

- `app.py` is HTTP-only — business logic belongs in `pipeline.py` or domain modules.
- `cache.py` backends share the same interface — no caller should reference `FileCache`/`S3Cache` directly.
- The `ListingsSource` protocol in `providers/__init__.py` must be satisfied by any new provider; `pipeline.py` tries each in order and uses the first success.
- Python is typed with strict mypy — all new code needs type annotations.
- `enricher.py` must never raise — failures are logged and the movie is returned with partial data.

---

## Anti-patterns

- Don't put business logic in `app.py` — HTTP layer only; logic belongs in `pipeline.py` or domain modules.
- Don't reference `FileCache` or `S3Cache` directly — use the `Cache` abstraction; backends are interchangeable.
- Don't raise in `enricher.py` — catch failures, log them, and return the movie with partial data.
- Don't add CloudWatch Dashboards, WAF, or X-Ray to `template.yaml` — these are paid-tier services.
- Don't add Lambda warm-up invocations to `deploy.sh`.
```

- [ ] **Step 2: Verify**

```bash
grep -n "scrapers\|MovieCard\|ShowtimesBlock\|ChipNav" AGENTS.md
```
Expected: no output (all old references are gone).

```bash
grep -n "Last synced\|useGeolocation\|Anti-patterns\|Common tasks" AGENTS.md
```
Expected: four matching lines.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: rewrite AGENTS.md to mirror updated CLAUDE.md"
```
