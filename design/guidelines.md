# Design guidelines — UI rewrite

Status: draft, 2026-10-04. The prototype (`design/prototype/index.html`) is the reference. Where it and this document disagree, this document wins and the prototype gets fixed.

## 1. Character

A printed cinema programme on cream paper. Serif display headings, sans-serif for everything you scan, a single warm amber accent, and posters supplying most of the colour. Quiet and orderly, with alignment doing the work that borders and boxes usually do.

Rules of thumb:
- **One accent.** Amber marks interactive or "yours" (booking, favourites, home rings). Never use it for decoration.
- **Alignment over containers.** Prefer a shared grid and hairline dividers to cards. Use cards only for things that float: the film page's showtimes panel, the ticket, and maps.
- **Posters are the imagery.** No illustrations or stock art; the only other image is the film backdrop.
- **Typographic hierarchy, not colour hierarchy.** Size and weight first, then the `--sub` grey.

## 2. Tokens

### Colour (light only)
| Token | Value | Role | Contrast |
|---|---|---|---|
| `--bg` | `#faf6ef` | Page background (paper) | — |
| `--surface` | `#ffffff` | Cards, pills, ticket stub | — |
| `--surface2` | `#f0ece4` | Placeholders | — |
| `--line` | `#ede8e0` | Hairline dividers between rows | — |
| `--border` | `#e0d8ce` | Control borders, perforation | — |
| `--text` | `#1a1a1a` | Primary text | 16.2:1 on bg |
| `--body` | `#4a443c` | Long-form text (synopsis) | 8.9:1 |
| `--sub` | `#786f61` | Secondary text | 4.6:1 on bg; **4.2:1 on `--surface2`, which fails for small text**, so don't put `--sub` text on `--surface2` |
| `--accent` | `#c17f3a` | Non-text accents only: chip borders, rings, focus | 3.1:1, so never use it for text |
| `--solid` | `#a06626` | Primary button fill (white text 4.75:1) | — |
| `--ink` | `#8f5620` | Accent text: ratings, favourite stars, active pills | 4.9:1 on wash |
| `--wash` | `#f5e8d4` | Active/selected background, filled timetable cells | — |
| Map land | `#efe8dc` | Map base | — |
| Map sea | `#dde5e2` | — | — |
| Map park | `#e2e3cf` | — | — |
| Map road | `#fbf8f2` | 3 px strokes | — |
| Map area label | `#a89c88` → **darken to `#7f7464`** | District names | 2.2:1 currently, which is too faint |

### Type
Fonts are self-hosted and Latin-subset: **Playfair Display** 600–700 and **DM Sans** 400–600. Use tabular figures wherever times or counts line up.

| Style | Font | Mobile / desktop | Use |
|---|---|---|---|
| Page title | Playfair 700 | 34 / 44, line-height 1 | "This week", "Monday", cinema name, film title (30 / 44) |
| Section heading | Playfair 700 | 22 | "Showtimes" |
| Row title | Playfair 700 | 18 / 20, line-height 1.15 | Film title in lists |
| Tagline | Playfair italic | 16 | Film page |
| Body | DM Sans 400 | 15, line-height 1.55, max 60ch | Synopsis |
| UI | DM Sans 500–600 | 13–16 | Pills, buttons, cinema names |
| Meta | DM Sans 400 | 12–13 | Rating · genres · runtime, summaries |
| Label | DM Sans 600, caps, +0.08em | 12 | Section labels ("ONLY A FEW SHOWINGS") |
| Micro | DM Sans 400–600 | 10–11 | Ticket fact labels, chip second lines, day-of-week |

Minimum 11 px for anything that carries information. 10 px is only for caps labels on the ticket.

### Space, size, shape
- **Spacing:** 4 px base; common steps are 4, 6, 8, 12, 14, 16, 20, 24, 32.
- **Page edge:** `--pad` is 16 px on mobile and 32 px from 900 px wide. Content max-width is 1120 px.
- **Breakpoint:** a single one, at 900 px. Below it is the phone layout, at or above it the desktop layout. Tablets get the phone layout scaled up, and that's acceptable.
- **Radii:**

  | Element | Radius |
  |---|---|
  | Posters | 6 |
  | Timetable cells | 7 |
  | Day-strip items and chips | 10 |
  | Buttons and ticket | 12–14 |
  | Maps | 14 |
  | Desktop panel | 16 |
  | Sheet top corners | 20 |
  | Pills | 99 |

- **Shadows:** only on floating things — the poster on the film page and the desktop panel. Warm-tinted: `rgba(60,40,10,…)`.

## 3. Layout

### The timetable grid (This week and Day)
The sticky day strip and every film row share one grid, so columns line up down the page:

- **Mobile:** `60px repeat(N, 1fr)` with a 4 px gap.
  - Column 1 holds the poster (52 px wide) in rows, and the "Week" cell in the strip.
  - Title, meta and summary span columns 2 to the end.
  - Day cells sit in columns 2 to N+1, one per day.
- **Desktop:** `72px minmax(0,1fr) repeat(N, 64px)` with a 6 px gap.
  - Column 2 holds the title and text.
  - Day cells sit to the right, vertically centred across the row.
  - "Week" spans columns 1–2 of the strip.
- N is the number of days in the horizon (normally 7). The grid must work with 5–8 columns.

Anything new on these pages must sit on this grid. If it can't, it probably belongs on a different page.

### Film page
- **Mobile:** single column. Backdrop hero 200 px → poster overlapping it by 72 px → about → actions → showtimes panel → map.
- **Desktop:** `1fr 440px`. The panel is a sticky card pulled up 140 px into a 380 px hero; it scrolls internally if it's taller than the viewport.

### Cinema and Cinemas pages
- **Cinema, desktop:** header text on the left, 480 px locator map on the right, aligned to the bottom edge.
- **Cinemas, desktop:** 560 px sticky map on the left, list on the right.

## 4. Components

Each entry lists its anatomy, then its states.

- **Pill:** 13 px semibold, 7 × 12 padding, 1 px border.
  - **Active** (`--wash`, `--ink` text, no border): Home set, a favourite cinema, Seen.
- **Day strip item:** weekday (11 px) above the date (16 px semibold).
  - **Selected:** inverted (text colour on bg colour), `aria-current`.
  - **Empty:** 35% opacity, not interactive.
  - **Not published yet:** a 1 px dashed `--border` outline inset 3 px, with the date in `--sub`. Still interactive, because it leads to the explanation.
- **Timetable cell:** 28 px high on mobile, 40 px on desktop.
  - **Filled:** `--wash` with an `--ink` count.
  - **Empty:** a 4 px `--border` dot.
  - **Not published yet:** a 135° hatch in `--line`, with no dot.
  - **The hit area must reach 44 px tall:** extend it with padding or a pseudo-element, not by changing the visual size. The prototype uses `::before { inset: -8px -2px }`.
- **Film row:** poster, title, meta, then either timetable cells and a summary line (week) or chips (day). Hairline divider below. Seen rows are at 60% opacity.
- **Showtime chip:** time (15 px semibold) over "short cinema · distance" (11 px `--sub`).
  - **Default:** accent border at 55%, accent fill at 10%.
  - **"+N more":** dashed and transparent.
  - **Past:** 40% opacity, not interactive.
- **Cinema row (film page):** a header line with the cinema name (15 px semibold, ★ if a favourite) and, on the same baseline, neighbourhood · distance (12 px `--sub`). Below it, wrapping time chips with an 8 px gap, each at least 44 px tall. Hairline divider below.
- **Tag:** 10 px semibold text with a 1 px border, radius 4, sitting 6 px after the time.
  - **IMAX:** `--text` border and text.
  - **Subtitles:** `--border` border and `--body` text.
  - Never more than two tags on one showing.
- **Ticket:**
  - A stub card with a dashed perforation and half-circle notches.
  - Three facts in columns: caps micro-label over a 17 px value.
  - The Where block: cinema name (links to its page), address · neighbourhood · distance. No map: the film page already showed where it is, and Directions is one tap away.
  - A full-width primary action, then two equal secondary actions: Share and Directions.
- **Star toggle:** a 38 px circle (with a 44 px hit area) that fills with `--wash` when on.
- **Empty state:** centred, with 48 px above. A Playfair 22 px title, one `--sub` sentence (max 34ch), and at most one pill action. The 404 page uses a 56 px title: "Not showing."
- **Home sheet:** reuses the ticket dialog. Title "Home", one line of explanation, the primary "Use my current location" button, a `role="status"` line for results and errors, then "Or tap the map" with a pickable map (crosshair cursor, no rings, frame fixed so it doesn't jump when the pin moves), then "Save home here" (disabled until there's a pin) and "Clear home" or "Cancel".
- **Notice:** a `--wash` block with radius 10, 10 × 12 padding, and 13 px `--ink` text. Used only for stale data.
- **Poster placeholder:** a 160° gradient from `--surface2` to `--wash` with a `--line` border, and the title in Playfair 700 `--ink`, clamped to 4 lines (8 px at 52 px wide, where it's decorative and `aria-hidden`).
- **Seen group:** a `<details>` element with a caps label and a ▾/▴ indicator; collapsed by default.

**Icons:** the prototype uses text glyphs (⌂ ◎ ★ ☆ ↗ ＋ ▶ ✓ ‹). The build should use one small inline SVG set (stroke 1.75, round caps) covering home, star (outline and filled), external, plus, play, check and back. No icon fonts, no emoji.

## 5. Maps

These are schematic, not cartographic. Their job is relative position and memory ("Girona is down Passeig de Gràcia from us"), not navigation; Directions hands off to the maps app.

### Projection and base layers
- Equirectangular, rotated **42° clockwise**, so the coast is horizontal with the sea at the bottom and Collserola at the top. That matches how people in Barcelona picture the city, and it puts the Eixample grid square to the screen.
- **Base layers,** in drawing order:
  - parks: Collserola, Montjuïc, Ciutadella;
  - roads: Diagonal, Gran Via, Passeig de Gràcia/Gran de Gràcia, La Rambla, Meridiana;
  - sea.
- The geometry is hand-simplified and stays rough. Area labels are optional.

### Markers and labels
- **Home:** 5.5 px `--text` dot with a white ring, labelled "Home".
- **Rings:** dashed accent circles at 1, 2 and 3 km, labelled "1 km"…
- **Cinema dots:**

  | Kind | Size and style |
  |---|---|
  | Focus | 5 px `--solid` with a white ring |
  | Other | 3.5 px grey |
  | Favourite (not focus) | white with an `--ink` ring |
  | Off-frame (Cinemas map only) | hollow, pinned to the edge with "Name 5.6 km →" |

- **Labels:** 11 px semibold with a 3 px land-coloured halo.
  - Placed greedily in priority order: Home, then focus cinemas, then favourites, then nearest first.
  - Candidate positions are right, left, top, bottom, then the diagonals.
  - A label that can't be placed is dropped. A dot is never dropped, and labels never cover dots.

### Framing
| Context | Frame | Size |
|---|---|---|
| Cinemas | Cinemas within 4 km of home (or all), min span 3 km | Mobile full width with automatic height; desktop 560 px |
| Cinema page | The cinema plus home, min span 3.2 km | 180 px mobile / 480 × 240 desktop |
| Film page | That day's cinemas plus home, min span 2.5 km | 230 px / 398 × 240 |
| Home sheet | Cinemas within 4.5 km of the centre, fixed while picking | Full width / 380 px |

- **Interaction:** dots link to cinema pages, except on the Home sheet's map, where a tap drops the pin. No pan or zoom in v1 (see requirements Q5).
- **Accessibility:** each map is `role="img"` with a summary label. The surrounding lists always carry the same information.
- **Text size under scaling:** maps are rendered for a known width, so labels stay 11 px. The build has to pick the width in a way that's compatible with CSP and pre-rendering. A fixed set of widths per context, switched with CSS, is the likely answer.

## 6. Interaction and motion

- **Navigation between pages** is plain links, with cross-document view transitions (a short fade, plus the poster morphing from list to film where possible).
- **Actions that don't navigate** — opening the ticket, toggling seen, toggling a favourite — happen in place with immediate visual feedback.
- **The sheet** slides up over 220 ms on mobile and fades and scales from 98% on desktop. It closes on backdrop tap, Esc or swipe down, and Back closes it rather than leaving the page.
- **Sticky elements:** the day strip on list pages, and the panel on desktop film pages. Nothing else.
- **Horizontal scroll** is only for chip rows on mobile, with the right edge bleeding to the screen edge to show there's more.
- **Reduced motion:** no transitions; the sheet appears instantly.

## 7. Words

- **Tone:** plain and short, in sentence case. Talk about the films, not the app.
- **Days and dates:**
  - "Today" (never "Tonight"); weekdays as "Mon", "Tuesday", "Tue 6"; months only where needed ("Sun 4 – Fri 9 Oct").
  - Times in 24-hour form ("21:30"); durations as "2h 05m".
- **Distance:** "250 m" (rounded to 50 m) under 1 km, then "1.5 km". With no home, use the neighbourhood name.
- **Cinema short names:** strip the chain prefix (Cines, Cinema, Cinemes, Cinesa, Mooby, Yelmo). "Verdi", not "Cines Verdi". Use the full name on cinema pages and the ticket.
- **Counts:** "1 showing", "3 showings", "1 film". Get the plural right.
- **Calls to action:** "Book at Verdi ↗", "Verdi website ↗", "Directions ↗", "Share". Every external link ends in ↗.
- **Empty states:**
  - "Saturday's listings aren't out yet. Cinemas usually publish a few days ahead. Check back later in the week."
  - "Nothing left today" (late in the day, every showing has started) / "Nothing on at Verdi today".
  - "No more showings" on a film page: "<Title> has no showings left in the listings. Its run may be over, or new dates may not be out yet."
  - "Not showing." (404).
- **Share text:** "<Title> · <Short cinema> · <Wd> <d>, <hh:mm>" plus a link.
