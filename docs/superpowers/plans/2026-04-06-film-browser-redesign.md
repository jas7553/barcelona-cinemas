# Film Browser Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the frontend as a mobile-first, dark-themed film browser with smart sorting, proximity-based theater ordering, and one-tap booking.

**Architecture:** Single-page React SPA; no new routes. App wires `useHiddenFilms` and `useGeolocation` hooks and passes state down. Smart sort and hidden-film filtering happen in `ShowtimesView`. `MovieRow` handles its own expand/collapse; `MovieList` enforces one-expanded-at-a-time. Theater lat/lng flows from `cinemas.json` → `transform.py` → API → frontend types.

**Tech Stack:** React 19, TypeScript, Vitest + @testing-library/react, Flask/Python backend (cinemas.json + transform.py only), existing Vite build.

---

## File Map

**New files:**
- `src/hooks/useHiddenFilms.ts` — localStorage-backed set of hidden film IDs
- `src/hooks/useHiddenFilms.test.ts` — tests
- `src/hooks/useGeolocation.ts` — `navigator.geolocation` wrapper
- `src/hooks/useGeolocation.test.ts` — tests

**Modified files:**
- `cinemas.json` — add `lat`, `lng` float fields to every cinema entry
- `models.py` — add `lat: float | None`, `lng: float | None` to `CinemaInfo`
- `transform.py` — include `lat`/`lng` in `_build_theaters` output
- `src/types.ts` — add `lat: number | null`, `lng: number | null` to `Theater`; remove `AppState`
- `src/utils.ts` — add `haversineKm`, `smartSort`
- `src/utils.test.ts` — add tests for new utils
- `src/style.css` — full dark-theme redesign
- `src/App.tsx` — wire hooks; pass simplified props to `ShowtimesView`
- `src/views/ShowtimesView.tsx` — remove all filter state; search + smart sort only
- `src/components/Header.tsx` — remove filter/count props; search only
- `src/components/MovieList.tsx` — remove sort/filter props; manage `expandedId` state
- `src/components/MovieRow.tsx` — collapsed/expanded design; hide button; proximity sort
- `src/components/TheaterCard.tsx` — show distance; flat showtime list with day labels
- `src/components/TimeChip.tsx` — become booking `<a>` link; hide past showtimes
- `src/components/MoviePoster.tsx` — dark fallback (amber letter on near-black)
- `src/components/Footer.tsx` — add "Show hidden films" link
- `src/App.test.tsx` — remove film-count-in-header test; update fixture to add `lat`/`lng`

**Deleted files:**
- `src/components/SortControl.tsx`
- `src/components/Sidebar.tsx` + `Sidebar.test.tsx`
- `src/components/FilterPanel.tsx` + `FilterPanel.test.tsx`
- `src/components/DateBar.tsx` + `DateBar.test.tsx`
- `src/components/TheaterFilterSheet.tsx`

---

## Task 1: Add lat/lng to cinemas.json and backend types

**Files:**
- Modify: `cinemas.json`
- Modify: `models.py`
- Modify: `transform.py`

- [ ] **Step 1: Add lat/lng coordinates to every entry in cinemas.json**

For each entry, add `"lat"` and `"lng"` float fields. These are the approximate GPS coordinates — verify against Google Maps if precision matters.

```json
"Verdi":    { ..., "lat": 41.4035, "lng": 2.1580 },
"VP":       { ..., "lat": 41.4045, "lng": 2.1575 },
"Malda":    { ..., "lat": 41.3826, "lng": 2.1740 },
"FdC":      { ..., "lat": 41.3797, "lng": 2.1686 },
"CinDiag":  { ..., "lat": 41.3889, "lng": 2.1183 },
"CinDigMar":{ ..., "lat": 41.4040, "lng": 2.2115 },
"SOM":      { ..., "lat": 41.4375, "lng": 2.1691 },
"Glòries":  { ..., "lat": 41.4036, "lng": 2.1886 },
"Aribau":   { ..., "lat": 41.3912, "lng": 2.1624 },
"Arenas":   { ..., "lat": 41.3761, "lng": 2.1466 },
"Balmes":   { ..., "lat": 41.4072, "lng": 2.1362 },
"Bosque":   { ..., "lat": 41.4029, "lng": 2.1570 },
"Girona":   { ..., "lat": 41.3997, "lng": 2.1682 },
"RenFlo":   { ..., "lat": 41.3804, "lng": 2.1613 },
"EspaiTexas":{ ..., "lat": 41.4013, "lng": 2.1658 },
"Maquinista":{ ..., "lat": 41.4392, "lng": 2.2041 },
"Filmax":   { ..., "lat": 41.3610, "lng": 2.1073 },
"Sarrià":   { ..., "lat": 41.4051, "lng": 2.1278 }
```

- [ ] **Step 2: Update CinemaInfo in models.py**

```python
class CinemaInfo(TypedDict):
    id: str
    name: str
    address: str
    neighborhood: str
    website_url: str
    maps_url: str
    lat: NotRequired[float | None]
    lng: NotRequired[float | None]
    aliases: NotRequired[dict[str, list[str]]]
```

- [ ] **Step 3: Include lat/lng in transform.py _build_theaters**

In `transform.py`, replace the `theaters.append(...)` block inside `_build_theaters`:

```python
def _build_theaters(
    cinema_lookup: dict[str, CinemaInfo],
    seen_theater_ids: set[str],
) -> list[dict[str, Any]]:
    theaters: list[dict[str, Any]] = []
    for info in cinema_lookup.values():
        if info["id"] in seen_theater_ids:
            theaters.append({
                "id":           info["id"],
                "name":         info["name"],
                "neighborhood": info["neighborhood"],
                "website_url":  info["website_url"],
                "maps_url":     info["maps_url"],
                "lat":          info.get("lat"),
                "lng":          info.get("lng"),
            })
    return theaters
```

- [ ] **Step 4: Run backend tests to verify no regressions**

```bash
pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add cinemas.json models.py transform.py
git commit -m "feat: add lat/lng coordinates to cinema registry and API response"
```

---

## Task 2: Update frontend Theater type

**Files:**
- Modify: `src/types.ts`
- Modify: `src/utils.test.ts` (update fixture)
- Modify: `src/App.test.tsx` (update fixture)

- [ ] **Step 1: Add lat/lng to Theater in src/types.ts**

Replace the `Theater` interface:

```typescript
export interface Theater {
  id: string;
  name: string;
  neighborhood: string;
  website_url: string;
  maps_url: string;
  lat: number | null;
  lng: number | null;
}
```

Also delete the `AppState` interface entirely — it will no longer be used.

- [ ] **Step 2: Update Theater fixtures in src/utils.test.ts**

Add `lat: null, lng: null` to the theater object in the `transformResponse` test:

```typescript
theaters: [
  {
    id: "verdi",
    name: "Cinemes Verdi",
    neighborhood: "Gracia",
    website_url: "https://cinesesverdi.com",
    maps_url: "https://maps.google.com/?q=Verdi",
    lat: null,
    lng: null,
  },
],
```

- [ ] **Step 3: Update Theater fixtures in src/App.test.tsx**

Add `lat: null, lng: null` to every theater object in `LISTINGS`:

```typescript
theaters: [
  {
    id: "verdi",
    name: "Cinemes Verdi",
    neighborhood: "Gràcia",
    website_url: "https://cinesesverdi.com",
    maps_url: "https://maps.google.com/?q=Verdi",
    lat: null,
    lng: null,
  },
],
```

- [ ] **Step 4: Update Theater fixture in src/components/MovieRow.test.tsx**

Add `lat: null, lng: null` to the theater in `BASE_MOVIE.showtimes[0].theater`:

```typescript
theater: {
  id: "verdi",
  name: "Cinemes Verdi",
  neighborhood: "Gracia",
  website_url: "https://cinesesverdi.com",
  maps_url: "https://maps.google.com/?q=Verdi",
  lat: null,
  lng: null,
},
```

- [ ] **Step 5: Run typecheck to verify no type errors**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/utils.test.ts src/App.test.tsx src/components/MovieRow.test.tsx
git commit -m "feat: add lat/lng to Theater type and update test fixtures"
```

---

## Task 3: Add haversineKm and smartSort to utils.ts

**Files:**
- Modify: `src/utils.ts`
- Modify: `src/utils.test.ts`

- [ ] **Step 1: Write failing tests for haversineKm and smartSort**

Append to `src/utils.test.ts`:

```typescript
import { haversineKm, smartSort } from "./utils";
import type { TransformedMovie } from "./types";

function makeMovie(overrides: Partial<TransformedMovie> & { id: string; showtimes: TransformedMovie["showtimes"] }): TransformedMovie {
  return {
    title: "Test Film",
    year: 2026,
    runtime_minutes: 90,
    runtimeLabel: "1h 30m",
    poster_url: null,
    genres: [],
    rating: 7.0,
    synopsis: "",
    links: { imdb: null },
    ...overrides,
  };
}

describe("haversineKm", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineKm(41.4035, 2.1580, 41.4035, 2.1580)).toBeCloseTo(0, 3);
  });

  it("returns ~1.0 km for nearby points in Barcelona", () => {
    // Verdi cinema to Mooby Bosque — roughly 100m apart
    const d = haversineKm(41.4035, 2.1580, 41.4029, 2.1570);
    expect(d).toBeGreaterThan(0.05);
    expect(d).toBeLessThan(0.3);
  });

  it("returns ~10 km for cross-city points", () => {
    // Verdi (Gràcia) to Filmax (L'Hospitalet)
    const d = haversineKm(41.4035, 2.1580, 41.3610, 2.1073);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(15);
  });
});

describe("smartSort", () => {
  const theater = {
    id: "t1", name: "T1", neighborhood: "A",
    website_url: "", maps_url: "", lat: null, lng: null,
  };
  const showtime = (date = "2099-01-01") => ({
    theater_id: "t1", theater, date, time: "20:00", language: "vo" as const, dayOffset: 1,
  });

  it("excludes hidden film IDs", () => {
    const movies = [
      makeMovie({ id: "a", showtimes: [showtime(), showtime(), showtime()] }),
      makeMovie({ id: "b", showtimes: [showtime()] }),
    ];
    const result = smartSort(movies, new Set(["a"]));
    expect(result.map(m => m.id)).toEqual(["b"]);
  });

  it("places last-chance (≤2 screenings) films first", () => {
    const movies = [
      makeMovie({ id: "popular", rating: 8.0, showtimes: [showtime(), showtime(), showtime(), showtime()] }),
      makeMovie({ id: "last-chance", rating: 5.0, showtimes: [showtime(), showtime()] }),
    ];
    const result = smartSort(movies, new Set());
    expect(result[0].id).toBe("last-chance");
  });

  it("places highly-rated (≥7.5) films before widely-screened", () => {
    const movies = [
      makeMovie({ id: "wide", rating: 6.0, showtimes: [showtime(), showtime(), showtime(), showtime(), showtime()] }),
      makeMovie({ id: "rated", rating: 8.0, showtimes: [showtime(), showtime(), showtime()] }),
    ];
    // wide has 5 screenings (above median of 4), rated has 3 (below median)
    // but rated >= 7.5 so it wins
    const result = smartSort(movies, new Set());
    expect(result[0].id).toBe("rated");
  });

  it("breaks ties within tier by rating descending", () => {
    const movies = [
      makeMovie({ id: "lower", rating: 7.0, showtimes: [showtime()] }),
      makeMovie({ id: "higher", rating: 8.0, showtimes: [showtime()] }),
    ];
    const result = smartSort(movies, new Set());
    expect(result[0].id).toBe("higher");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/utils.test.ts
```

Expected: `haversineKm` and `smartSort` fail with "is not a function" or similar.

- [ ] **Step 3: Implement haversineKm and smartSort in src/utils.ts**

Append to `src/utils.ts`:

```typescript
// ── Geo distance ────────────────────────────────────────────────────────────

/** Haversine formula — returns distance in kilometres. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Smart sort ──────────────────────────────────────────────────────────────

/**
 * Sort films into four priority tiers:
 *   0 = last chance (≤2 remaining screenings)
 *   1 = highly rated (TMDb ≥ 7.5)
 *   2 = widely screened (above-median screening count)
 *   3 = everything else
 * Within each tier, sort by rating descending.
 * Films in hiddenIds are excluded entirely.
 */
export function smartSort(movies: TransformedMovie[], hiddenIds: Set<string>): TransformedMovie[] {
  const visible = movies.filter((m) => !hiddenIds.has(m.id));

  const counts = visible.map((m) => m.showtimes.length).sort((a, b) => a - b);
  const median = counts.length === 0 ? 0 : counts[Math.floor(counts.length / 2)];

  const tier = (m: TransformedMovie): number => {
    if (m.showtimes.length <= 2) return 0;
    if ((m.rating ?? 0) >= 7.5) return 1;
    if (m.showtimes.length > median) return 2;
    return 3;
  };

  return [...visible].sort((a, b) => {
    const diff = tier(a) - tier(b);
    if (diff !== 0) return diff;
    return (b.rating ?? 0) - (a.rating ?? 0);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/utils.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils.ts src/utils.test.ts
git commit -m "feat: add haversineKm and smartSort utils"
```

---

## Task 4: useHiddenFilms hook

**Files:**
- Create: `src/hooks/useHiddenFilms.ts`
- Create: `src/hooks/useHiddenFilms.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/hooks/useHiddenFilms.test.ts`:

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useHiddenFilms } from "./useHiddenFilms";

describe("useHiddenFilms", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts with an empty set when localStorage is empty", () => {
    const { result } = renderHook(() => useHiddenFilms());
    expect(result.current.hiddenIds.size).toBe(0);
  });

  it("hideFilm adds the id to hiddenIds", () => {
    const { result } = renderHook(() => useHiddenFilms());
    act(() => { result.current.hideFilm("movie-1"); });
    expect(result.current.hiddenIds.has("movie-1")).toBe(true);
  });

  it("hideFilm persists the id to localStorage", () => {
    const { result } = renderHook(() => useHiddenFilms());
    act(() => { result.current.hideFilm("movie-1"); });
    const stored = JSON.parse(localStorage.getItem("hidden_film_ids") ?? "[]");
    expect(stored).toContain("movie-1");
  });

  it("clearHidden empties hiddenIds", () => {
    const { result } = renderHook(() => useHiddenFilms());
    act(() => { result.current.hideFilm("movie-1"); });
    act(() => { result.current.clearHidden(); });
    expect(result.current.hiddenIds.size).toBe(0);
  });

  it("clearHidden removes the key from localStorage", () => {
    const { result } = renderHook(() => useHiddenFilms());
    act(() => { result.current.hideFilm("movie-1"); });
    act(() => { result.current.clearHidden(); });
    expect(localStorage.getItem("hidden_film_ids")).toBeNull();
  });

  it("initialises from existing localStorage data", () => {
    localStorage.setItem("hidden_film_ids", JSON.stringify(["movie-a", "movie-b"]));
    const { result } = renderHook(() => useHiddenFilms());
    expect(result.current.hiddenIds.has("movie-a")).toBe(true);
    expect(result.current.hiddenIds.has("movie-b")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/hooks/useHiddenFilms.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement useHiddenFilms**

Create `src/hooks/useHiddenFilms.ts`:

```typescript
import { useCallback, useState } from "react";

const STORAGE_KEY = "hidden_film_ids";

function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function useHiddenFilms() {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(loadHidden);

  const hideFilm = useCallback((id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const clearHidden = useCallback(() => {
    setHiddenIds(new Set());
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { hiddenIds, hideFilm, clearHidden };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/hooks/useHiddenFilms.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useHiddenFilms.ts src/hooks/useHiddenFilms.test.ts
git commit -m "feat: add useHiddenFilms hook with localStorage persistence"
```

---

## Task 5: useGeolocation hook

**Files:**
- Create: `src/hooks/useGeolocation.ts`
- Create: `src/hooks/useGeolocation.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/hooks/useGeolocation.test.ts`:

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useGeolocation } from "./useGeolocation";

describe("useGeolocation", () => {
  let mockGetCurrentPosition: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: mockGetCurrentPosition },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null before geolocation resolves", () => {
    mockGetCurrentPosition.mockImplementation(() => { /* never calls back */ });
    const { result } = renderHook(() => useGeolocation());
    expect(result.current).toBeNull();
  });

  it("returns coords after geolocation resolves", async () => {
    mockGetCurrentPosition.mockImplementation((success: PositionCallback) => {
      success({ coords: { latitude: 41.4035, longitude: 2.1580 } } as GeolocationPosition);
    });
    const { result } = renderHook(() => useGeolocation());
    expect(result.current).toEqual({ lat: 41.4035, lng: 2.1580 });
  });

  it("returns null if geolocation is denied", () => {
    mockGetCurrentPosition.mockImplementation(
      (_success: PositionCallback, error: PositionErrorCallback) => {
        error({ code: 1, message: "denied" } as GeolocationPositionError);
      }
    );
    const { result } = renderHook(() => useGeolocation());
    expect(result.current).toBeNull();
  });

  it("returns null if navigator.geolocation is unavailable", () => {
    Object.defineProperty(navigator, "geolocation", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useGeolocation());
    expect(result.current).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/hooks/useGeolocation.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement useGeolocation**

Create `src/hooks/useGeolocation.ts`:

```typescript
import { useEffect, useState } from "react";

export interface Coords {
  lat: number;
  lng: number;
}

export function useGeolocation(): Coords | null {
  const [coords, setCoords] = useState<Coords | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* denied or unavailable — stay null */ },
    );
  }, []);

  return coords;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/hooks/useGeolocation.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGeolocation.ts src/hooks/useGeolocation.test.ts
git commit -m "feat: add useGeolocation hook"
```

---

## Task 6: Dark theme CSS

**Files:**
- Modify: `src/style.css`

The entire file is replaced. The new CSS preserves class names for components that aren't being removed, updates the design tokens for a dark theme, removes all rules for deleted components (`.sidebar`, `.filter-panel`, `.date-bar`, `.sort-control`, `.theater-filter-*`), and adds new rules for the redesigned components.

- [ ] **Step 1: Replace the design tokens block (`:root`)**

Replace everything between `/* ── Design tokens */` and the end of the `:root` block with:

```css
:root {
  --bg:           #111111;
  --bg-card:      #1c1c1c;
  --bg-elevated:  #242424;
  --text:         #ede9e3;
  --text-muted:   #888480;
  --accent:       #e8a020;
  --border:       #2e2c29;
  --shadow:       0 1px 2px rgba(0,0,0,0.5);
  --radius:       10px;
  --radius-sm:    6px;
  --font-sans:    "DM Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  --header-h:     52px;
  --poster-w-mobile:  clamp(60px, 20vw, 80px);
  --poster-w-desktop: 100px;
}
```

- [ ] **Step 2: Update base body and layout rules**

Replace `body { ... }` and the layout wrapper rules:

```css
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.layout {
  max-width: 680px;
  margin: 0 auto;
  padding: 0 16px;
}
```

- [ ] **Step 3: Replace header styles**

```css
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  height: var(--header-h);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
}

.logo { text-decoration: none; display: flex; align-items: baseline; gap: 3px; }
.logo-bcn { font-size: 18px; font-weight: 700; color: var(--text); letter-spacing: -0.5px; }
.logo-cinemas { font-size: 13px; font-weight: 400; color: var(--text-muted); }

.search-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.search-wrap svg {
  position: absolute;
  left: 9px;
  width: 15px;
  height: 15px;
  color: var(--text-muted);
  pointer-events: none;
}

.search-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

.search-input {
  width: 100%;
  padding: 7px 10px 7px 32px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 14px;
  outline: none;
}

.search-input::placeholder { color: var(--text-muted); }
.search-input:focus { border-color: var(--accent); }
```

- [ ] **Step 4: Replace movie list and skeleton styles**

```css
.movie-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 12px 0;
}

/* ── Skeleton ── */
.skeleton-row {
  display: flex;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}

.skeleton-block {
  background: var(--bg-elevated);
  border-radius: var(--radius-sm);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
}

.skeleton-poster  { width: var(--poster-w-mobile); aspect-ratio: 2/3; flex-shrink: 0; border-radius: var(--radius-sm); }
.skeleton-content { flex: 1; display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
.skeleton-title   { height: 18px; width: 55%; }
.skeleton-meta    { height: 14px; width: 35%; }
.skeleton-synopsis  { height: 12px; width: 90%; }
.skeleton-synopsis-2 { height: 12px; width: 70%; }
.skeleton-chips   { height: 22px; width: 45%; margin-top: 4px; }
```

- [ ] **Step 5: Replace movie row styles**

```css
/* ── Movie row ── */
.movie-row {
  display: flex;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.movie-row-collapsed {
  display: flex;
  gap: 12px;
  width: 100%;
}

.movie-row-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }

.movie-row-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.movie-title { font-size: 15px; font-weight: 600; color: var(--text); line-height: 1.3; }
.movie-year  { font-size: 13px; color: var(--text-muted); }
.movie-runtime { font-size: 13px; color: var(--text-muted); }

.movie-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.rating-pill {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  white-space: nowrap;
}

.tag-genre {
  font-size: 11px;
  padding: 2px 7px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 20px;
  color: var(--text-muted);
  white-space: nowrap;
}

.last-chance-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--accent);
  text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
}

.hide-btn {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--text-muted);
  line-height: 1;
  flex-shrink: 0;
  opacity: 0.5;
}

.hide-btn:focus-visible { outline: 2px solid var(--accent); border-radius: 4px; }

/* Expanded section */
.movie-row-expanded { padding-top: 12px; display: flex; flex-direction: column; gap: 12px; }
.synopsis { font-size: 13px; color: var(--text-muted); line-height: 1.6; margin: 0; }
.showtimes-grid { display: flex; flex-direction: column; gap: 10px; }
```

- [ ] **Step 6: Replace poster styles**

```css
/* ── Poster ── */
.movie-poster {
  width: var(--poster-w-mobile);
  aspect-ratio: 2/3;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
}

@media (min-width: 480px) {
  .movie-poster { width: var(--poster-w-desktop); }
}

.movie-poster-image { width: 100%; height: 100%; object-fit: cover; display: block; }

.movie-poster-fallback {
  width: 100%;
  height: 100%;
  background: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
}

.movie-poster-letter {
  font-size: 28px;
  font-weight: 700;
  color: var(--accent);
  opacity: 0.7;
}
```

- [ ] **Step 7: Replace theater card and time chip styles**

```css
/* ── Theater card ── */
.theater-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}

.tcard-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.tcard-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
}

.tcard-name:hover { text-decoration: underline; }

.tcard-neighborhood { font-size: 12px; color: var(--text-muted); }

.tcard-distance {
  font-size: 12px;
  color: var(--accent);
  margin-left: auto;
}

.day-rows { display: flex; flex-direction: column; gap: 6px; }

.day-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.day-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  min-width: 36px;
}

.day-label.today { color: var(--accent); }

.times-wrap { display: flex; gap: 6px; flex-wrap: wrap; }

/* ── Time chip (booking link) ── */
.time-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  min-height: 44px;
  padding: 6px 10px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  text-decoration: none;
  white-space: nowrap;
}
```

- [ ] **Step 8: Replace footer and miscellaneous styles**

```css
/* ── Empty / error states ── */
.error-state { padding: 40px 16px; text-align: center; }
.empty-icon  { font-size: 32px; margin-bottom: 12px; }
.empty-text  { color: var(--text-muted); font-size: 14px; }

.retry-btn {
  margin-top: 12px;
  padding: 8px 20px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
}

/* ── Listing metadata ── */
.list-footer-meta {
  padding: 12px 0 4px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.list-footer-meta.is-stale { color: var(--accent); }

/* ── Footer ── */
.site-footer {
  padding: 24px 16px 40px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.footer-disclaimer { font-size: 12px; color: var(--text-muted); text-align: center; margin: 0; }

.show-hidden-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  color: var(--text-muted);
  text-decoration: underline;
  cursor: pointer;
}

/* ── Accessibility ── */
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

.skip-link {
  position: absolute; left: 12px; top: -48px; z-index: 500;
  padding: 8px 12px; background: var(--bg-card); border: 1px solid var(--accent);
  border-radius: var(--radius-sm); color: var(--text); text-decoration: none;
}

.skip-link:focus, .skip-link:focus-visible { top: 12px; }
```

- [ ] **Step 9: Run the dev server and visually verify the dark theme loads without errors**

```bash
npm run dev
```

Open `http://localhost:5173` in a browser. Expected: dark background, app renders without console errors.

- [ ] **Step 10: Run all frontend tests**

```bash
npm run test:run
```

Expected: any test failures at this point are fixture-only (not logic failures). Fix any CSS-class-name assertions if they surface.

- [ ] **Step 11: Commit**

```bash
git add src/style.css
git commit -m "feat: dark theme CSS redesign"
```

---

## Task 7: Simplify MoviePoster fallback

**Files:**
- Modify: `src/components/MoviePoster.tsx`

The fallback already handles the case — we just need to remove the per-title hue gradient and use a flat dark background with an amber letter, consistent with the new design tokens.

- [ ] **Step 1: Update MoviePoster to use dark fallback**

Replace the entire `MoviePoster.tsx`:

```typescript
import { useState } from "react";

interface Props {
  title: string;
  posterUrl: string | null;
}

export default function MoviePoster({ title, posterUrl }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(posterUrl) && !imageFailed;

  return (
    <div className="movie-poster" aria-hidden="true">
      {showImage ? (
        <img
          className="movie-poster-image"
          data-testid="movie-poster-image"
          src={posterUrl ?? undefined}
          alt=""
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="movie-poster-fallback" data-testid="movie-poster-fallback">
          <span className="movie-poster-letter">
            {title[0]?.toUpperCase() ?? "?"}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run existing MoviePoster tests (via MovieRow tests)**

```bash
npm run test:run -- src/components/MovieRow.test.tsx
```

Expected: the 3 poster tests (`renders a poster image`, `renders the designed fallback`, `falls back when the poster image fails`) all pass. The IMDb tests may fail due to changed props — that's expected and will be fixed in Task 10.

- [ ] **Step 3: Commit**

```bash
git add src/components/MoviePoster.tsx
git commit -m "refactor: simplify MoviePoster to dark fallback style"
```

---

## Task 8: Convert TimeChip to booking link

**Files:**
- Modify: `src/components/TimeChip.tsx`

- [ ] **Step 1: Rewrite TimeChip as a booking anchor**

Replace the entire `TimeChip.tsx`:

```typescript
import type { TransformedShowtime } from "../types";

interface Props {
  showtime: TransformedShowtime;
}

export default function TimeChip({ showtime }: Props) {
  const now = new Date();
  const [y, mo, d] = showtime.date.split("-").map(Number);
  const [h, m] = showtime.time.split(":").map(Number);
  const showDatetime = new Date(y, mo - 1, d, h, m);

  if (showDatetime < now) return null;

  return (
    <a
      className="time-chip"
      href={showtime.theater.website_url || "#"}
      target="_blank"
      rel="noreferrer"
      aria-label={`Book ${showtime.time} at ${showtime.theater.name} (opens in a new tab)`}
    >
      {showtime.time}
    </a>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TimeChip.tsx
git commit -m "feat: convert TimeChip to booking link anchor"
```

---

## Task 9: Update TheaterCard

**Files:**
- Modify: `src/components/TheaterCard.tsx`

The new `TheaterCard` no longer takes `selectedDate`. It always shows all days, grouped into day rows. It receives an optional `distanceKm` to display.

- [ ] **Step 1: Rewrite TheaterCard**

Replace the entire `TheaterCard.tsx`:

```typescript
import type { TransformedShowtime } from "../types";
import { formatDayLabel, todayAtMidnight } from "../utils";
import TimeChip from "./TimeChip";

interface Props {
  showtimes: TransformedShowtime[];
  distanceKm: number | null;
}

export default function TheaterCard({ showtimes, distanceKm }: Props) {
  if (showtimes.length === 0) return null;
  const theater = showtimes[0].theater;

  const byDay = new Map<number, TransformedShowtime[]>();
  for (const s of showtimes) {
    const arr = byDay.get(s.dayOffset) ?? [];
    arr.push(s);
    byDay.set(s.dayOffset, arr);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a - b);

  const today = todayAtMidnight();

  return (
    <div className="theater-card">
      <div className="tcard-head">
        <span className="tcard-name">{theater.name}</span>
        <span className="tcard-neighborhood">{theater.neighborhood}</span>
        {distanceKm !== null && (
          <span className="tcard-distance">{distanceKm.toFixed(1)} km</span>
        )}
      </div>
      <div className="day-rows">
        {days.map(([offset, times]) => {
          const date = new Date(today);
          date.setDate(today.getDate() + offset);
          const label = formatDayLabel(offset, date);
          const chips = times.map((s, i) => <TimeChip key={i} showtime={s} />).filter(Boolean);
          if (chips.length === 0) return null;
          return (
            <div className="day-row" key={offset}>
              <span className={`day-label${offset === 0 ? " today" : ""}`}>{label}</span>
              <div className="times-wrap">{chips}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TheaterCard.tsx
git commit -m "feat: update TheaterCard with distance display and simplified day grouping"
```

---

## Task 10: Redesign MovieRow

**Files:**
- Modify: `src/components/MovieRow.tsx`
- Modify: `src/components/MovieRow.test.tsx`

The new `MovieRow`:
- Takes `isExpanded: boolean`, `onToggle: () => void`, `onHide: (id: string) => void`, `coords: { lat: number; lng: number } | null`
- No longer takes `filters` or `forceExpanded`
- Collapsed: poster + title/year/runtime + rating/genres + last-chance badge + hide button
- Expanded: synopsis + theaters sorted by proximity

- [ ] **Step 1: Replace MovieRow.test.tsx with updated tests**

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MovieRow from "./MovieRow";
import type { TransformedMovie } from "../types";

const THEATER = {
  id: "verdi",
  name: "Cinemes Verdi",
  neighborhood: "Gràcia",
  website_url: "https://cinesverdi.com",
  maps_url: "https://maps.google.com/?q=Verdi",
  lat: 41.4035,
  lng: 2.1580,
};

const BASE_MOVIE: TransformedMovie = {
  id: "movie-1",
  title: "Project Hail Mary",
  year: 2025,
  runtime_minutes: 157,
  runtimeLabel: "2h 37m",
  poster_url: "https://image.tmdb.org/t/p/w342/project-hail-mary.jpg",
  genres: ["Sci-Fi"],
  rating: 8.2,
  synopsis: "A lone astronaut races to save humanity.",
  links: { imdb: "https://www.imdb.com/title/tt12042730" },
  showtimes: [
    {
      theater_id: "verdi",
      theater: THEATER,
      date: "2099-06-01",
      time: "18:00",
      language: "vo",
      dayOffset: 0,
    },
  ],
};

function renderRow(overrides?: Partial<TransformedMovie>, expanded = false) {
  const onToggle = vi.fn();
  const onHide = vi.fn();
  render(
    <MovieRow
      movie={{ ...BASE_MOVIE, ...overrides }}
      isExpanded={expanded}
      onToggle={onToggle}
      onHide={onHide}
      coords={null}
    />
  );
  return { onToggle, onHide };
}

describe("MovieRow collapsed", () => {
  it("renders the movie title", () => {
    renderRow();
    expect(screen.getByText("Project Hail Mary")).toBeInTheDocument();
  });

  it("renders a poster image when poster_url is present", () => {
    renderRow();
    expect(screen.getByTestId("movie-poster-image")).toHaveAttribute("src", BASE_MOVIE.poster_url);
  });

  it("renders the fallback when poster_url is missing", () => {
    renderRow({ poster_url: null });
    expect(screen.getByTestId("movie-poster-fallback")).toBeInTheDocument();
  });

  it("renders rating", () => {
    renderRow();
    expect(screen.getByText(/8\.2/)).toBeInTheDocument();
  });

  it("does not render synopsis when collapsed", () => {
    renderRow();
    expect(screen.queryByText("A lone astronaut races to save humanity.")).not.toBeInTheDocument();
  });

  it("calls onToggle when the row is clicked", () => {
    const { onToggle } = renderRow();
    fireEvent.click(screen.getByRole("article"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("calls onHide when the hide button is clicked without triggering onToggle", () => {
    const { onToggle, onHide } = renderRow();
    const hideBtn = screen.getByRole("button", { name: /hide/i });
    fireEvent.click(hideBtn);
    expect(onHide).toHaveBeenCalledWith("movie-1");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shows Last Chance badge when showtimes.length <= 2", () => {
    renderRow();
    expect(screen.getByText(/last chance/i)).toBeInTheDocument();
  });

  it("does not show Last Chance badge when showtimes.length > 2", () => {
    const extras = Array.from({ length: 3 }, (_, i) => ({ ...BASE_MOVIE.showtimes[0], time: `${18 + i}:00` }));
    renderRow({ showtimes: [...BASE_MOVIE.showtimes, ...extras] });
    expect(screen.queryByText(/last chance/i)).not.toBeInTheDocument();
  });
});

describe("MovieRow expanded", () => {
  it("renders synopsis when expanded", () => {
    renderRow(undefined, true);
    expect(screen.getByText("A lone astronaut races to save humanity.")).toBeInTheDocument();
  });

  it("renders theater name when expanded", () => {
    renderRow(undefined, true);
    expect(screen.getByText("Cinemes Verdi")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:run -- src/components/MovieRow.test.tsx
```

Expected: tests fail because MovieRow still has the old interface.

- [ ] **Step 3: Rewrite MovieRow.tsx**

```typescript
import type { AppState, TransformedMovie, TransformedShowtime } from "../types";
import type { Coords } from "../hooks/useGeolocation";
import { haversineKm } from "../utils";
import MoviePoster from "./MoviePoster";
import TheaterCard from "./TheaterCard";

interface Props {
  movie: TransformedMovie;
  isExpanded: boolean;
  onToggle: () => void;
  onHide: (id: string) => void;
  coords: Coords | null;
}

function RatingPill({ rating }: { rating: number }) {
  return <span className="rating-pill">★ {rating.toFixed(1)}</span>;
}

export default function MovieRow({ movie, isExpanded, onToggle, onHide, coords }: Props) {
  const isLastChance = movie.showtimes.length <= 2;
  const shownGenres = movie.genres.slice(0, 3);

  // Group showtimes by theater
  const theaterMap = new Map<string, TransformedShowtime[]>();
  for (const s of movie.showtimes) {
    const arr = theaterMap.get(s.theater.id) ?? [];
    arr.push(s);
    theaterMap.set(s.theater.id, arr);
  }

  // Sort theaters by distance if coords available, else alphabetically
  const theaterEntries = [...theaterMap.entries()].sort(([, aShowtimes], [, bShowtimes]) => {
    const aTheater = aShowtimes[0].theater;
    const bTheater = bShowtimes[0].theater;
    if (coords && aTheater.lat != null && aTheater.lng != null && bTheater.lat != null && bTheater.lng != null) {
      const aDist = haversineKm(coords.lat, coords.lng, aTheater.lat, aTheater.lng);
      const bDist = haversineKm(coords.lat, coords.lng, bTheater.lat, bTheater.lng);
      return aDist - bDist;
    }
    return aTheater.name.localeCompare(bTheater.name);
  });

  return (
    <article
      id={`film-${movie.id}`}
      className="movie-row"
      onClick={onToggle}
      role="article"
    >
      <div className="movie-row-collapsed">
        <MoviePoster title={movie.title} posterUrl={movie.poster_url} />

        <div className="movie-row-content">
          <div className="movie-row-top">
            <div>
              <span className="movie-title">{movie.title}</span>
              {movie.year != null && <span className="movie-year"> · {movie.year}</span>}
              {movie.runtimeLabel && <span className="movie-runtime"> · {movie.runtimeLabel}</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
              {isLastChance && <span className="last-chance-badge">Last Chance</span>}
              <button
                className="hide-btn"
                aria-label={`Hide ${movie.title}`}
                onClick={(e) => { e.stopPropagation(); onHide(movie.id); }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </button>
            </div>
          </div>

          <div className="movie-meta">
            {movie.rating != null && <RatingPill rating={movie.rating} />}
            {shownGenres.map((g) => <span key={g} className="tag-genre">{g}</span>)}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="movie-row-expanded">
          {movie.synopsis && <p className="synopsis">{movie.synopsis}</p>}
          <div className="showtimes-grid">
            {theaterEntries.map(([theaterId, times]) => {
              const theater = times[0].theater;
              const distanceKm =
                coords && theater.lat != null && theater.lng != null
                  ? haversineKm(coords.lat, coords.lng, theater.lat, theater.lng)
                  : null;
              return (
                <TheaterCard key={theaterId} showtimes={times} distanceKm={distanceKm} />
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test:run -- src/components/MovieRow.test.tsx
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/MovieRow.tsx src/components/MovieRow.test.tsx
git commit -m "feat: redesign MovieRow with collapsed/expanded state and hide button"
```

---

## Task 11: Simplify MovieList

**Files:**
- Modify: `src/components/MovieList.tsx`

`MovieList` now manages `expandedId` state and passes `isExpanded`/`onToggle` to each `MovieRow`. The sort control and filter props are removed.

- [ ] **Step 1: Rewrite MovieList.tsx**

```typescript
import { useState } from "react";
import { relativeTime } from "../utils";
import type { TransformedMovie } from "../types";
import type { Coords } from "../hooks/useGeolocation";
import EmptyState from "./EmptyState";
import MovieRow from "./MovieRow";

interface Props {
  movies: TransformedMovie[];
  allMoviesEmpty: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  generatedAt: string | null;
  stale: boolean;
  onHide: (id: string) => void;
  coords: Coords | null;
}

const SKELETON_COUNT = 5;

export default function MovieList({
  movies,
  allMoviesEmpty,
  loading,
  error,
  onRetry,
  generatedAt,
  stale,
  onHide,
  coords,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renderedAt] = useState(() => Date.now());

  const generatedTimestamp = generatedAt == null ? Number.NaN : Date.parse(generatedAt);
  const showStaleNotice =
    stale ||
    (Number.isFinite(generatedTimestamp) &&
      renderedAt - generatedTimestamp > 24 * 60 * 60 * 1000);

  if (loading) {
    return (
      <div className="movie-list" aria-hidden="true">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <div key={i} className="skeleton-row">
            <div className="skeleton-poster skeleton-block" />
            <div className="skeleton-content">
              <div className="skeleton-block skeleton-title" />
              <div className="skeleton-block skeleton-meta" />
              <div className="skeleton-block skeleton-synopsis" />
              <div className="skeleton-block skeleton-synopsis-2" />
              <div className="skeleton-block skeleton-chips" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-state">
        <div className="empty-icon">⚠️</div>
        <p className="empty-text">Couldn't load listings. Try refreshing.</p>
        <button className="retry-btn" onClick={onRetry}>Retry</button>
      </div>
    );
  }

  return (
    <>
      {movies.length === 0 ? (
        <>
          <EmptyState noListings={allMoviesEmpty} />
          {generatedAt && (
            <div className={`list-footer-meta${showStaleNotice ? " is-stale" : ""}`}>
              Listings last updated {relativeTime(generatedAt)}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="movie-list">
            {movies.map((m) => (
              <MovieRow
                key={m.id}
                movie={m}
                isExpanded={m.id === expandedId}
                onToggle={() => setExpandedId(m.id === expandedId ? null : m.id)}
                onHide={onHide}
                coords={coords}
              />
            ))}
          </div>
          {generatedAt && (
            <div className={`list-footer-meta${showStaleNotice ? " is-stale" : ""}`}>
              Listings last updated {relativeTime(generatedAt)}
            </div>
          )}
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MovieList.tsx
git commit -m "refactor: simplify MovieList, manage expand state internally"
```

---

## Task 12: Simplify Header

**Files:**
- Modify: `src/components/Header.tsx`

Remove `filmCount`, `filterPanelOpen`, `onToggleFilter`, `activeFilterCount`. Keep only `searchQuery` and `onSearch`.

- [ ] **Step 1: Rewrite Header.tsx**

```typescript
interface Props {
  searchQuery: string;
  onSearch: (q: string) => void;
}

export default function Header({ searchQuery, onSearch }: Props) {
  return (
    <header className="header">
      <a className="logo" href="/">
        <span className="logo-bcn">BCN</span>
        <span className="logo-cinemas">cinemas</span>
      </a>

      <div className="search-wrap">
        <label className="search-label" htmlFor="search-input">Search films</label>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
        <input
          id="search-input"
          type="search"
          className="search-input"
          placeholder="Search films…"
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
          autoComplete="off"
        />
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Header.tsx
git commit -m "refactor: simplify Header to logo + search only"
```

---

## Task 13: Wire up App and ShowtimesView, delete dead components

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/views/ShowtimesView.tsx`
- Modify: `src/App.test.tsx`
- Delete: `src/components/SortControl.tsx`, `src/components/Sidebar.tsx`, `src/components/Sidebar.test.tsx`, `src/components/FilterPanel.tsx`, `src/components/FilterPanel.test.tsx`, `src/components/DateBar.tsx`, `src/components/DateBar.test.tsx`, `src/components/TheaterFilterSheet.tsx`

- [ ] **Step 1: Rewrite ShowtimesView.tsx**

```typescript
import { useCallback, useMemo, useState } from "react";
import type { SharedProps } from "../App";
import { normalizeForSearch, smartSort } from "../utils";
import type { Coords } from "../hooks/useGeolocation";
import Header from "../components/Header";
import MovieList from "../components/MovieList";
import Footer from "../components/Footer";

interface Props extends SharedProps {
  coords: Coords | null;
}

export default function ShowtimesView({
  movies,
  theaters,
  generatedAt,
  stale,
  loading,
  error,
  onRetry,
  hiddenIds,
  onHide,
  coords,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredMovies = useMemo(() => {
    const q = normalizeForSearch(searchQuery);
    const searched = q
      ? movies.filter((m) => normalizeForSearch(m.title).includes(q))
      : movies;
    return smartSort(searched, hiddenIds);
  }, [movies, searchQuery, hiddenIds]);

  const statusMessage = loading
    ? "Loading movie listings."
    : error
      ? "Could not load movie listings."
      : `${filteredMovies.length} ${filteredMovies.length === 1 ? "film" : "films"} shown.`;

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to listings</a>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </div>

      <Header searchQuery={searchQuery} onSearch={setSearchQuery} />

      <div className="layout">
        <main id="main-content" aria-labelledby="page-title" aria-busy={loading}>
          <h1 className="sr-only" id="page-title">Barcelona English-language cinema listings</h1>
          <MovieList
            movies={filteredMovies}
            allMoviesEmpty={movies.length === 0}
            loading={loading}
            error={error}
            onRetry={onRetry}
            generatedAt={generatedAt}
            stale={stale}
            onHide={onHide}
            coords={coords}
          />
        </main>
      </div>

      <Footer hiddenCount={hiddenIds.size} onClearHidden={() => onHide("__clear__")} />
    </>
  );
}
```

- [ ] **Step 2: Rewrite App.tsx**

```typescript
import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { fetchListings } from "./api";
import type { Theater, TransformedMovie } from "./types";
import { transformResponse } from "./utils";
import { useHiddenFilms } from "./hooks/useHiddenFilms";
import { useGeolocation } from "./hooks/useGeolocation";
import ShowtimesView from "./views/ShowtimesView";

export interface SharedProps {
  movies: TransformedMovie[];
  theaters: Theater[];
  generatedAt: string | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  hiddenIds: Set<string>;
  onHide: (id: string) => void;
}

export default function App() {
  const [movies, setMovies] = useState<TransformedMovie[]>([]);
  const [theaters, setTheaters] = useState<Theater[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { hiddenIds, hideFilm, clearHidden } = useHiddenFilms();
  const coords = useGeolocation();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchListings()
      .then((data) => {
        setMovies(transformResponse(data));
        setTheaters(data.theaters);
        setGeneratedAt(data.generated_at);
        setStale(data.stale);
      })
      .catch(() => setError("fetch failed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchListings()
      .then((data) => {
        if (cancelled) return;
        setMovies(transformResponse(data));
        setTheaters(data.theaters);
        setGeneratedAt(data.generated_at);
        setStale(data.stale);
      })
      .catch(() => { if (!cancelled) setError("fetch failed"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // "__clear__" is a sentinel value used by ShowtimesView's Footer to clear hidden films
  const handleHide = useCallback((id: string) => {
    if (id === "__clear__") clearHidden();
    else hideFilm(id);
  }, [hideFilm, clearHidden]);

  const shared: SharedProps = {
    movies,
    theaters,
    generatedAt,
    stale,
    loading,
    error,
    onRetry: load,
    hiddenIds,
    onHide: handleHide,
  };

  return (
    <Routes>
      <Route path="/showtimes" element={<ShowtimesView {...shared} coords={coords} />} />
      <Route path="*" element={<Navigate to="/showtimes" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 3: Update ShowtimesView Footer call — Footer needs a new interface**

The Footer import in ShowtimesView uses `hiddenCount` and `onClearHidden` — these will be wired in Task 14. For now, pass them through without rendering (Task 14 updates Footer).

- [ ] **Step 4: Delete dead component files**

```bash
rm src/components/SortControl.tsx
rm src/components/Sidebar.tsx src/components/Sidebar.test.tsx
rm src/components/FilterPanel.tsx src/components/FilterPanel.test.tsx
rm src/components/DateBar.tsx src/components/DateBar.test.tsx
rm src/components/TheaterFilterSheet.tsx
```

- [ ] **Step 5: Update App.test.tsx — remove film-count-in-header test**

In `src/App.test.tsx`, delete the test:

```typescript
it("renders film count in header after loading", async () => {
  render(<MemoryRouter initialEntries={["/showtimes"]}><App /></MemoryRouter>);
  await waitFor(() =>
    expect(screen.getByText("1 film")).toBeInTheDocument()
  );
});
```

That test assumed the film count appeared in the header. It no longer does. The status count is still tested via the `sr-only` status region.

- [ ] **Step 6: Run the full test suite**

```bash
npm run test:run
```

Expected: all tests pass (any remaining failures indicate a type or import issue to fix).

- [ ] **Step 7: Run typecheck**

```bash
npm run typecheck
```

Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/views/ShowtimesView.tsx src/App.test.tsx
git add -u src/components/  # stages deletions
git commit -m "feat: wire up App and ShowtimesView with hooks; delete dead components"
```

---

## Task 14: Add "Show hidden films" to Footer

**Files:**
- Modify: `src/components/Footer.tsx`

- [ ] **Step 1: Update Footer to accept and render the show-hidden control**

```typescript
import TmdbAttribution from "./TmdbAttribution";

interface Props {
  hiddenCount: number;
  onClearHidden: () => void;
}

export default function Footer({ hiddenCount, onClearHidden }: Props) {
  return (
    <footer className="site-footer">
      <TmdbAttribution />
      <p className="footer-disclaimer">BCNcinemas is not affiliated with any cinema chain.</p>
      {hiddenCount > 0 && (
        <button className="show-hidden-btn" onClick={onClearHidden}>
          Show {hiddenCount} hidden {hiddenCount === 1 ? "film" : "films"}
        </button>
      )}
    </footer>
  );
}
```

- [ ] **Step 2: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 3: Run typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

Open `http://localhost:5173`. Verify:
- Dark theme renders
- Films appear smart-sorted (last chance first if any have ≤2 screenings)
- Tapping a film row expands it showing synopsis and showtimes
- Tapping again collapses it
- Only one row is expanded at a time
- Hide button removes a film
- Footer "Show N hidden films" button appears and restores films
- Search filters the list
- Time chips link to theater website

- [ ] **Step 5: Commit**

```bash
git add src/components/Footer.tsx
git commit -m "feat: add show-hidden-films control to Footer"
```

---

## Self-Review

**Spec coverage check:**
- ✅ §3 Single page, no routing — all routing removed except `/showtimes` redirect
- ✅ §4 Smart sort (4 tiers, hidden excluded) — `smartSort` in utils.ts
- ✅ §5 Collapsed row (poster, title, year, runtime, rating, genres, last-chance, hide) — Task 10
- ✅ §6 Expanded row (synopsis, theaters sorted by distance, time chips → booking links) — Tasks 8, 9, 10
- ✅ §7 Search — preserved in ShowtimesView
- ✅ §8 Geolocation (request on load, fallback if denied, in-memory only) — Task 5
- ✅ §9 Hidden films (localStorage, clear via footer) — Tasks 4, 14
- ✅ §10 Booking links (theater website_url, fallback) — Task 8
- ✅ §11 Design language (dark, amber, no hover animations) — Task 6
- ✅ §12 Out of scope items — not implemented
- ✅ §13 lat/lng added to Theater type and API response — Tasks 1, 2

**Type consistency check:**
- `Coords` from `useGeolocation` is `{ lat: number; lng: number }` — used consistently in `MovieRow`, `MovieList`, `ShowtimesView`, `App`
- `hideFilm(id: string)` / `clearHidden()` from `useHiddenFilms` — `App` uses a `handleHide` sentinel pattern (`"__clear__"`) to unify the two calls into one `onHide` prop. This is a code smell — consider whether `ShowtimesView` should instead receive `clearHidden` directly as a separate prop. The sentinel approach works but is non-obvious; document it in a comment.

**Placeholder scan:** None found.

**Ambiguity fix:** The `"__clear__"` sentinel in `App.handleHide` is a shortcut to avoid threading `clearHidden` separately through `SharedProps`. It works, but if it causes confusion during implementation, refactor `SharedProps` to include a separate `onClearHidden: () => void` prop and update `ShowtimesView` and `Footer` accordingly.
