# Film Browser Redesign — Design Spec
**Date:** 2026-04-06
**Status:** Approved

---

## 1. Goal

Redesign the Barcelona English-cinema frontend as a mobile-first film browser optimized for a single job: scan what's playing this week, find something worth seeing, and book it in as few taps as possible.

---

## 2. User & Context

- Primary device: iPhone (Safari), portrait orientation
- Usage pattern: open the app, scan for interesting films, expand one, tap a showtime to book
- Spoiler-sensitive: wants minimal info by default (no synopsis until tapped)
- Already-seen films should disappear from the list
- Wants nearest theaters surfaced first — doesn't have cinema distances memorized

---

## 3. Information Architecture

Single page, no routing. The app does not navigate to any secondary view — expanding a film row is the only state change that resembles navigation.

**Page structure (top → bottom):**
1. Header — app name/logo + search icon
2. Film list — smart-sorted, single column

No date bar, no filter panel, no sidebar, no navigation tabs.

---

## 4. Smart Sort Order

Films are sorted client-side using the following priority tiers (ties within a tier fall back to TMDb rating descending):

| Priority | Signal | Definition |
|---|---|---|
| 1 | Last chance | ≤ 2 total screenings remaining in the dataset |
| 2 | Highly rated | TMDb rating ≥ 7.5 |
| 3 | Widely screened | Above-median screening count |
| 4 | Everything else | Remaining films, rating descending |

Films hidden by the user are excluded entirely before sorting.

---

## 5. Film Row — Collapsed State

Each film renders as a horizontal row:

- **Left:** poster thumbnail (~64×96px, rounded corners). If `poster_url` is null or the image fails to load, render a styled placeholder: dark background with the film's initial letter centered.
- **Right of poster:**
  - Line 1: Film title (bold) · year · runtime (e.g. "1h 34m")
  - Line 2: ★ rating (amber) · genre chips (2–3 max, no overflow label needed)
- **Top-right corner:** "Last chance" badge if applicable (small, amber, text only — no icon)
- **Bottom-right corner:** Hide button (eye-slash icon, small, muted) — one tap hides the film

Tapping anywhere on the row (except the hide button) expands it.

---

## 6. Film Row — Expanded State

Expands inline below the collapsed content. No animation — state changes are immediate.

- Brief synopsis (one paragraph, plain text)
- Showtimes section:
  - Grouped by theater
  - Theaters sorted by distance from user (nearest first) if geolocation was granted; alphabetically otherwise
  - Each theater header: name · neighborhood · distance (e.g. "Mooby Bosque · Gràcia · 0.8 km") — distance omitted if location unavailable
  - Below each theater header: time chips for that film at that theater
  - Each time chip is a tappable link (44px minimum touch target) that opens the theater's booking page
  - Time chips show the showtime only (e.g. "20:15") — no language label needed (all listings are English-accessible by definition)
- Tapping the row again (outside a time chip) collapses it

Only one row is expanded at a time.

---

## 7. Search

Tapping the search icon in the header reveals a text input inline in the header. Typing filters the film list in real time by title (case-insensitive, normalized). Clearing the input or tapping a close icon restores the full list. Search does not affect sort order — matching films remain in their smart-sorted positions.

---

## 8. Geolocation

- On first visit (or first expand of a film row), request `navigator.geolocation.getCurrentPosition()`
- If granted: use coordinates to calculate distance to each theater (Haversine formula against theater lat/lng — requires adding lat/lng to `cinemas.json`)
- If denied or unavailable: fall back gracefully — theaters sort alphabetically, no distance shown
- Coordinates are used in-memory only, never persisted

> **Open question:** `cinemas.json` currently has address strings but no lat/lng coordinates. These will need to be added manually or geocoded once during setup.

---

## 9. Already-Seen / Hidden Films

- Tapping the hide button on a film row adds the film's `id` to a `Set` stored in `localStorage` under the key `hidden_film_ids`
- Hidden films are excluded from the rendered list entirely
- A small "Show hidden films" text link in the footer clears the hidden set and restores all films
- No confirmation dialog — the footer link is the undo mechanism

---

## 10. Booking Links

- Each time chip links to the theater's `website_url` (from the API response)
- Links open in a new tab
- If the scraper is later enhanced to capture per-showtime booking URLs, they slot in as the chip `href` with no UI change required

---

## 11. Design Language

Inspired by Letterboxd, IMDb, and TMDb — dark, editorial, film-first.

- **Background:** near-black (`#0f0f0f` or similar)
- **Text:** off-white primary, muted secondary
- **Accent:** amber/gold for ratings, badges, and interactive highlights
- **Typography:** clean sans-serif, generous line height, clear hierarchy between title / metadata / synopsis
- **No hover animations**, no layout shift, no elements moving when tapped or hovered
- **Whitespace:** used effectively — rows feel distinct without excessive padding; content is dense but not cramped
- Poster with subtle drop shadow; no harsh borders on cards

---

## 12. Out of Scope (Deferred)

The following were discussed and explicitly deferred:

- Date/day filtering (add later if needed)
- Genre filtering
- Language filtering (all listings are English-accessible)
- Theater filtering
- Letterboxd integration for auto-tracking seen films
- Per-showtime deep booking URLs (requires scraper work)
- "Next week" listings (current scraper covers 7 days; extend scraper separately if desired)

---

## 13. Data Model Compatibility

The existing API response (`/api/listings`) requires one addition to support geolocation-based sorting:

- Add `lat` and `lng` float fields to each entry in `cinemas.json` (and correspondingly to the `Theater` type in `models.py` and `src/types.ts`)

All other required data (`poster_url`, `rating`, `genres`, `synopsis`, `showtimes`, `theater.website_url`) is already present in the current response.
