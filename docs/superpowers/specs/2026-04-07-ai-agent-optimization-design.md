# AI Agent Optimization — Design Spec
**Date:** 2026-04-07
**Status:** Approved

---

## 1. Goal

Optimize the codebase for efficient use by AI agents (primarily Claude Code). Reduce wasted tokens during exploration and implementation by ensuring `CLAUDE.md` is accurate, complete, and structured to answer the most common agent questions without requiring additional file reads.

---

## 2. Approach

Option B: Fix stale content + enrich `CLAUDE.md` with new sections. Keep both `CLAUDE.md` (primary, authoritative) and `AGENTS.md` (Codex/other agents, synced from `CLAUDE.md`). Claude Code is used ~90% of the time.

---

## 3. File Map Corrections

### Remove (don't exist after the 2026-04 redesign)

These components are listed in the current `CLAUDE.md` but were deleted:
- `DateBar`
- `FilterPanel`
- `Sidebar`
- `SortControl`
- `TheaterFilterSheet`

### Add (missing from current `CLAUDE.md`)

| File | Purpose |
|---|---|
| `src/views/ShowtimesView.tsx` | Main view: film list with smart sort, search, and hidden-film exclusion |
| `src/hooks/useGeolocation.ts` | Geolocation request + Haversine distance calculations |
| `src/hooks/useHiddenFilms.ts` | localStorage-backed hidden film set (`hidden_film_ids`) |

### Fix

- `src/App.tsx` description: remove "routes to views" — there is no routing. App renders `ShowtimesView` directly.

---

## 4. New Section: Data Models

Two subsections to prevent agents opening files just to understand shapes.

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

> `transform.py` owns this translation. Notably: the internal `Showtime.cinema` (a name string matching a `cinemas.json` key) becomes `theater_id` (the cinema's `id` field) in the public shape.

---

## 5. New Section: Environment Variables

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

## 6. New Section: Common Task Checklists

Prevents agents from missing coupled files when making common changes.

| Task | Files to touch |
|---|---|
| Add/rename a data field | `models.py` → `src/types.ts` → `transform.py` (+ `enricher.py` if TMDb-sourced, + `validation.py` if validated) |
| Add a new cinema | `cinemas.json` only — add `lat`/`lng` if known |
| Add a new provider | Implement `ListingsSource` protocol → register in `providers/__init__.py` |
| Add a frontend component | `src/components/ComponentName.tsx` + co-located `ComponentName.test.tsx` |
| Change the API contract | `transform.py` → `src/types.ts` → `src/utils.ts` (`transformResponse`) |

---

## 7. New Section: Anti-Patterns

Makes implicit constraints explicit.

- Don't put business logic in `app.py` — HTTP layer only
- Don't reference `FileCache`/`S3Cache` directly — use the `Cache` abstraction
- Don't raise in `enricher.py` — log the failure, return partial data
- Don't add CloudWatch Dashboards, WAF, or X-Ray to `template.yaml` — paid tier, not needed
- Don't add Lambda warm-up invocations to `deploy.sh`

---

## 8. AGENTS.md Strategy

- Add a sync note at the top: "Mirrors `CLAUDE.md` — `CLAUDE.md` is the source of truth. Last synced: YYYY-MM-DD."
- Apply all the same corrections and new sections as `CLAUDE.md`
- Keep any Codex-specific differences (e.g. the `scrapers/` reference in the architecture diagram is already wrong and should be corrected to `providers/`)

---

## 9. Out of Scope

- Sub-directory `CLAUDE.md` files (Option C) — deferred; codebase is small enough that root-level context is sufficient
- No changes to application code, tests, or infrastructure
