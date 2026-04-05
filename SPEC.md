# BCNcinemas Redesign — Implementation Spec

## Overview

BCNcinemas is a personal website for discovering what films are playing in Barcelona cinemas this week. It scrapes showtime data from various sources and presents it for browsing. The site is served from CloudFront at `https://dzoh7wlkfif2d.cloudfront.net`.

This spec covers a UI/UX redesign with two goals:
1. Build a new **Discover view** (`/films`) — a "what should I watch?" catalog page that becomes the default landing page.
2. Restyle the existing **Showtimes view** (`/showtimes`) to share the same design system.

**Out of scope:** Letterboxd integration, ticketing/booking, user accounts, backend scraper changes (except adding derived fields to the existing data).

---

## Reference Prototype

A working React prototype is attached as `bcncinemas-v2-redesign.jsx`. It implements the Discover view with the complete design system (colors, typography, components, layout, interactions). Use it as the visual and structural reference. When this spec and the prototype conflict, the spec takes precedence.

The live site is at: https://dzoh7wlkfif2d.cloudfront.net
A full-page PDF capture of the current site is attached as `Barcelona_This_Week.pdf`.

---

## Design Direction

### Theme: "Editorial warmth"

The current site uses a dark cinema-chain aesthetic. Replace it with a warm, light theme inspired by:
- **Curzon** (curzon.com) — clean film listings, approachable typography
- **Letterboxd** — film browse UX, genre filtering, poster-forward cards
- **MUBI** — curatorial confidence, scarcity badges ("leaving soon"), small-catalog elegance
- **Fandango** — "Movies In Theaters" page genre filtering, "Opening This Week" sections
- **Metrograph** — serif/sans typography pairing, editorial feel

### Why light, not dark

The site is a personal discovery tool, not a cinema chain booking system. It is most often used on mobile in daylight (cafés, transit, walking). Light themes have better readability in ambient light, and the warm paper-like background lets poster art pop without competing with a dark chrome.

---

## Design Tokens

Implement these as CSS custom properties on `:root` so a future dark mode toggle is trivial. All component styles must reference these variables — no hardcoded colors.

```css
:root {
  /* Backgrounds */
  --bg:             #FAFAF8;
  --bg-card:        #FFFFFF;
  --bg-card-hover:  #F7F6F3;
  --bg-muted:       #F2F1ED;
  --bg-accent:      #FFF8EE;

  /* Borders */
  --border:         #E8E6E1;
  --border-light:   #F0EEEA;

  /* Text */
  --text:           #1A1A1A;
  --text-secondary: #6B6560;
  --text-muted:     #9C9790;

  /* Accent — warm terracotta, deliberately not blue or amber */
  --accent:         #D4622B;
  --accent-hover:   #BF5523;
  --accent-soft:    #FEF0E7;

  /* Semantic colors */
  --green:          #2D7D46;
  --green-soft:     #EDFAEF;
  --purple:         #6B4FBB;
  --purple-soft:    #F3F0FF;
  --red:            #C4391D;
  --red-soft:       #FFF0ED;
  --gold:           #B8860B;
  --gold-soft:      #FFF9E6;

  /* Elevation */
  --shadow:         0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06);
  --shadow-hover:   0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);

  /* Radii */
  --radius:         12px;
  --radius-sm:      8px;

  /* Typography */
  --font-serif:     "Source Serif 4", "Georgia", "Times New Roman", serif;
  --font-sans:      "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

### Typography rules

- **Film titles:** `--font-serif`, weight 700. This gives the catalog an editorial magazine feel. Titles are the primary content — they should feel literary, not utilitarian.
- **All UI chrome** (buttons, labels, metadata, genre chips, nav): `--font-sans`, various weights.
- **Synopsis text:** `--font-serif`, weight 400, for readability in longer text blocks.
- **Load via Google Fonts:** `Source Serif 4` (400, 400i, 700) and `DM Sans` (400, 500, 600, 700).

---

## Page Structure & Routing

```
/              → redirect to /films
/films         → Discover view (new, default landing page)
/films?genre=Horror&sort=rating  → Discover with filters persisted in URL
/showtimes     → Showtimes view (existing view, restyled)
/showtimes?film=project-hail-mary → Showtimes scrolled/filtered to a specific film
```

### Shared sticky header (both views)

The header is shared across both views and sticky at the top. It contains:

1. **Logo row:** "BCN" in `--accent` + "cinemas" in `--text`, both in `--font-serif` at 20px weight 700. Right-aligned: two toggle buttons "Discover" / "Showtimes" indicating which view is active.
2. **Search bar:** full-width, `--bg-muted` background, rounded corners, search icon left-aligned. Searches film titles, genres, and description text. Present on both views.
3. **Genre filter pills:** horizontally scrollable row of pill buttons. "All" is the default. Active pill uses `--accent` background with white text. Inactive pills have `--border` outline. These appear on the Discover view; on the Showtimes view, replace with day-filter pills.

The header has `backdrop-filter: blur(12px)` on a semi-transparent `--bg` to create a frosted-glass effect as content scrolls underneath.

---

## Discover View (`/films`)

### Purpose

Help the user decide **what** to watch. No showtime details — just enough metadata to make a decision: poster, title, rating, genres, synopsis, IMDb link, and a "See showtimes" CTA that navigates to the Showtimes view.

### Data model

The backend scraper already produces film and showtime data. For the Discover view, compute these derived fields during the scrape/transform step (or at query time):

```typescript
interface FilmDiscovery {
  id: string;                    // URL-safe slug, e.g. "project-hail-mary"
  title: string;
  year: number;
  runtime: string;               // e.g. "2h 37m"
  ratingImdb: number | null;     // e.g. 8.2
  genres: string[];              // e.g. ["Science Fiction", "Adventure"]
  description: string;           // synopsis/overview
  posterUrl: string | null;      // TMDb w300 URL
  imdbUrl: string | null;        // full IMDb title URL

  // Derived from showtime data:
  theaterCount: number;          // distinct theaters showing this film
  screeningCount: number;        // total screening count across all days
  isNewRelease: boolean;         // year === currentYear
  isLimitedRun: boolean;         // screeningCount <= 3
  isLastChance: boolean;         // last screening is within 48 hours from now
  availableDays: string[];       // e.g. ["Today", "Tomorrow", "Tue", "Wed"]
}
```

### Layout

#### Mobile (<640px) — primary target
Single-column list of film cards, full width. This is the layout shown in the prototype.

#### Tablet (640–1024px)
Two-column grid of film cards. Cards in grid mode should be vertical: poster on top (aspect-ratio 2:3, full card width), text content below. The expanded state (synopsis + actions) appears below the card, spanning the full grid width, pushing subsequent cards down.

#### Desktop (>1024px)
Three-column grid of film cards. Same vertical card layout as tablet. Consider moving genre filter pills and sort controls into a left sidebar instead of the horizontal scroll.

### Film card component

Each card has two states:

**Collapsed (default):**
- Poster thumbnail (72×108px on mobile, full-width on tablet/desktop grid) with badge overlay
- Title (serif, 16px, 700, max 2 lines with ellipsis)
- Rating pill (color-coded: green ≥8, gold ≥7, muted ≥6, red <6)
- Year • Runtime (sans, 13px, muted)
- Genre chips (max 3 shown, "+N" for overflow)
- Availability summary: "{N} theaters • {N} screenings" (sans, 12px, muted)
- Expand chevron (right-aligned, rotates 180° on expand)

**Expanded (tap to toggle):**
All of the above, plus:
- Synopsis paragraph (serif, 14px, `--text-secondary`, line-height 1.65)
- "Showing" day strip: row of day chips showing which days the film screens. "Today" chip uses `--accent-soft` background and `--accent` text.
- Action bar: IMDb button (yellow `#F5C518` background, black text, opens in new tab) on the left. "See showtimes →" button (`--accent` background, white text, navigates to `/showtimes?film={slug}`) on the right.

### Poster handling

- When `posterUrl` is available: `<img>` with `loading="lazy"`, `alt="{title} ({year}) poster"`
- When `posterUrl` is null: render a gradient placeholder using a hash of the title to generate varied hue values, with the first letter of the title centered at low opacity. See the `PosterPlaceholder` component in the prototype.
- Always use 2:3 aspect ratio (standard movie poster proportions).

### Badges

Badges appear on the poster corner (absolute positioned, top-left). Show only the highest-priority badge per film:

| Priority | Label         | Color                    | Condition                          |
|----------|---------------|--------------------------|------------------------------------|
| 1        | "Last chance" | `--red` on `--red-soft`  | Last screening within 48h          |
| 2        | "Limited run" | `--purple` on `--purple-soft` | screeningCount ≤ 3            |
| 3        | "New"         | `--accent` on `--accent-soft` | year === currentYear           |

Style: 10px, weight 700, uppercase, letter-spacing 0.05em, border-radius 4px, padding 3px 7px.

### Sections (default view, no active filters)

When no genre filter or search is active, group films into labeled sections:

1. **"Highlights"** — top 3 films by rating. Subtitle: "Highest rated this week."
2. **"Don't miss"** — films where `isLimitedRun || isLastChance`, excluding any already in Highlights. Subtitle: "Limited screenings — book before they're gone."
3. **"Now playing"** — everything else, sorted by rating descending.

When a genre filter is active or search is non-empty, collapse into a flat sorted list — sections become noise when the user is actively narrowing.

### Section headers

Each section has:
- Title: serif, 20px, weight 700
- Subtitle (optional): sans, 14px, `--text-muted`
- Count (right-aligned): sans, 13px, `--text-muted`, e.g. "4 films"

### Sort control

A sort dropdown appears below the sticky header, right-aligned. Options:
- "Rating" (default) — descending by `ratingImdb`
- "Title A–Z" — alphabetical
- "Most screenings" — descending by `screeningCount`

Use a native `<select>` element for screen reader compatibility. Style it with `--bg-muted` background.

### Filter state in URL

Persist `genre` and `sort` in URL query parameters so filtered states are shareable and survive page refresh:
- `/films?genre=Horror&sort=rating`
- When "All" genre is selected, omit the `genre` param.

### Empty state

When no films match the filter/search combination, show:
- A search icon (32px)
- "No films match your filters" (serif, 15px, weight 500)
- "Try a different genre or search term" (sans, 13px, muted)

---

## Showtimes View (`/showtimes`)

### Purpose

Help the user decide **where and when** to see a film they've already chosen. This is the existing view, restyled with the new design system.

### What changes from the current site

1. **Theme:** Apply the same light design tokens (backgrounds, borders, text colors, typography) defined above. No more dark background.
2. **Header:** Use the shared sticky header. The "Showtimes" nav button is now active instead of "Discover." Genre filter pills are replaced with **day filter pills**: "All days", "Today", "Tomorrow", "Tue 7", "Wed 8", etc.
3. **Theater filter:** On mobile, the left sidebar theater list is replaced with a "Filter by theater" button that opens a **bottom sheet** modal. On desktop (>1024px), keep the sidebar. The bottom sheet has: a drag handle bar at top, "Filter by Theater" title, a scrollable list of theater names as tappable rows, and a dimmed backdrop that closes the sheet on tap.
4. **Film cards:** Each film listing uses the same card styling (white background, `--border-light` border, `--shadow`, `--radius` corners). Film title uses serif font. Metadata uses sans.
5. **Showtime chips:** Individual screening time buttons get larger tap targets (min 44px height), `--bg-muted` background, `--border` border, `--radius-sm` corners, `--text` color, `--font-sans` weight 600. Hover/active state: `--accent` border and text color.
6. **Past showtime styling:** Showtimes that have already elapsed today should have `opacity: 0.4`, `text-decoration: line-through`, and `cursor: default`. Do not make them tappable.
7. **Theater grouping:** Showtimes are grouped by theater, then by day within each theater — this matches the current structure and is correct. Each theater block is a card with `--bg` background inside the main card. Theater name is sans weight 700, neighborhood is sans weight 400 in `--text-muted`.
8. **Day labels:** "Today" label uses `--accent` color. All other day labels use `--text-muted`, uppercase, 11px, weight 600, letter-spacing 0.05em.
9. **Deep linking:** When arriving via `/showtimes?film=project-hail-mary`, scroll to that film's card and expand it automatically. Highlight it briefly (e.g., a subtle background pulse using `--accent-soft`).
10. **Sort options:** Add a sort dropdown matching the Discover view style. Options: "Rating", "Title A–Z", "Soonest showtime", "Most screenings".

### What stays the same

- The underlying data model for showtimes (theater → day → times)
- The film metadata displayed (title, year, runtime, rating, genres, description, poster, IMDb link)
- VOSE (versión original subtitulada) labels on showtime chips — keep these

---

## Responsive Layout Summary

### Mobile (<640px) — primary target

- Single column, full-width content
- Sticky header with horizontal scroll for filter pills
- Film cards: horizontal layout (poster left 72×108, text right)
- Theater filter: bottom sheet modal triggered by button
- Max-width: none (edge-to-edge with 12px horizontal padding on the card container)

### Tablet (640–1024px)

- Discover: 2-column card grid, vertical card layout (poster on top)
- Showtimes: single column (showtime tables don't grid well)
- Sticky header same as mobile
- Theater filter: bottom sheet or dropdown

### Desktop (>1024px)

- Discover: 3-column card grid, max-width 1200px centered
- Showtimes: single column, max-width 800px centered
- Consider moving genre/theater filters to a left sidebar (200px wide)
- Sticky header remains but search bar could be narrower

### Shared responsive rules

- All interactive elements (buttons, chips, links): minimum 44px tap target on mobile
- Poster images: `loading="lazy"`
- Horizontal scroll containers: `scrollbar-width: none` / `::-webkit-scrollbar { display: none }`
- Card gaps: 10px on mobile, 16px on tablet/desktop grid

---

## Accessibility Requirements

- All interactive elements need visible focus states (use `--accent` outline, 2px offset)
- Poster images: `alt="{title} ({year}) poster"`
- Genre filter group: wrap in a `<fieldset>` with `<legend>` or use `role="radiogroup"` with `aria-label`
- Sort dropdown: native `<select>` element (not a custom dropdown)
- Expanded card state: use `aria-expanded` on the card trigger
- Bottom sheet modal: trap focus, close on Escape, `role="dialog"`, `aria-label="Filter by theater"`
- Color contrast: all text/background combinations must meet WCAG AA (4.5:1 for normal text, 3:1 for large text). The token values above have been checked.
- Badge text: since badges use colored backgrounds, ensure the text contrast ratio passes. The token pairings above (e.g., `--red` on `--red-soft`) are designed to pass.

---

## Component Inventory

These are the reusable components needed across both views. The prototype implements all of them — refer to it for exact styling.

| Component | Used in | Description |
|-----------|---------|-------------|
| `StickyHeader` | Both | Logo, nav toggle, search, filter pills |
| `GenreChip` / `DayChip` | Discover / Showtimes | Pill-shaped filter toggle buttons |
| `FilmCard` | Both | Collapsed/expanded film info card |
| `RatingDisplay` | Both | Color-coded IMDb rating pill with star icon |
| `FilmBadge` | Discover | Priority badge ("Last chance" / "Limited run" / "New") |
| `PosterPlaceholder` | Both | Gradient + letter fallback when posterUrl is null |
| `SectionHeader` | Discover | Section title + subtitle + count |
| `ShowtimeChip` | Showtimes | Individual screening time button with VOSE label |
| `TheaterBlock` | Showtimes | Theater name + neighborhood + grouped day/time chips |
| `TheaterFilterSheet` | Showtimes (mobile) | Bottom sheet modal for theater selection |
| `SortControl` | Both | Sort dropdown (native select) |
| `IMDbButton` | Both (expanded) | Yellow IMDb branded link button |
| `ShowtimesCTA` | Discover (expanded) | "See showtimes →" primary action button |

---

## Implementation Order

Suggested sequence to minimize wasted work:

1. **Design system foundation:** CSS custom properties, font loading, base styles, shared `StickyHeader` component.
2. **Restyle Showtimes view:** Apply new theme to the existing view. This validates the design tokens work with real data before building anything new.
3. **Build Discover view:** New page using the prototype as reference. Wire up to existing film data (add derived fields).
4. **Routing:** Set up `/films` and `/showtimes` routes, default redirect, query param persistence.
5. **Responsive polish:** Tablet and desktop grid layouts, sidebar filter on desktop, bottom sheet on mobile.
6. **Accessibility pass:** Focus states, aria attributes, keyboard navigation.

---

## Footer

Both views share a footer:
- Border-top using `--border`
- Text: "Listings updated every 30 minutes. Poster images and metadata from TMDb." (sans, 12px, `--text-muted`, centered)
- Below: "BCNcinemas is not affiliated with any cinema chain." (sans, 11px, `--text-muted`)
