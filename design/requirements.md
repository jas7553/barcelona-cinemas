# Requirements — UI rewrite

Status: draft, 2026-10-04. Prototype: `design/prototype/index.html`; visual and interaction rules: `design/guidelines.md`.

The front-end is being rebuilt from scratch. Treat the current `src/` as a record of past behaviour, not a spec. Anything worth keeping is written down here.

## 1. Who it's for

Two people in Barcelona (a film enthusiast and his partner) choosing an English-language screening. Mostly iPhone Safari; desktop is a real second surface, not an afterthought. No accounts, no analytics, no growth goals. Reject features that only make sense for hypothetical other users.

How they actually use it:
- **They plan ahead.** Going the same day is rare. They usually look a few days out, but not on a fixed rhythm like "every weekend".
- **Where matters as much as when.** They prefer something near home and have a few favourite cinemas. They don't have a clear mental map of where the cinemas are.
- **They're spoiler-averse,** the second person especially.

## 2. Principles, in priority order

1. **Every showing links to booking for that exact showing.** This is the primary call to action, and showings are never collapsed into a summary like "Daily 11:30, 16:00…". Breaking it is the most serious possible regression.
2. **The week is the default unit, not tonight.** Today is one day among the others.
3. **Show where alongside when.** Wherever a showing appears, its cinema and distance from home (or the neighbourhood, if there's no home) appear with it. Maps give a spatial sense; they don't replace the lists.
4. **Film-first, with cinemas one tap away.** People browse films. A cinema's page is reachable from everywhere that cinema is named.
5. **Spoiler-conscious by default:** poster, genres, tagline, short synopsis. No reviews and no detailed plot, including in share previews.
6. **Fast, and real content on first paint:** pre-rendered pages, little JavaScript, no layout shift after load.
7. **Calm.** No badges or counts that demand attention, and no gimmicks.

## 3. Pages and URLs

Every view that changes the main content has its own URL, and that URL renders real content on first paint. Back, Forward, reload and sharing all work.

| Page | URL (indicative) | Purpose |
|---|---|---|
| This week | `/` | Every film on in the data horizon, as a timetable |
| Day | `/?day=YYYY-MM-DD` or `/day/YYYY-MM-DD/` | One day's films, each with its showtimes |
| Film | `/film/<slug>/` (`?day=`) | About the film, then its showings one day at a time, plus a map |
| Cinema | `/cinema/<id>/` (`?day=`) | One cinema's programme one day at a time, plus a locator map |
| Cinemas | `/cinemas/` | Map of all cinemas plus a list; manage favourites |
| Privacy | `/privacy/` | What's stored on the device (home, seen films, favourites), and that nothing leaves it |
| 404 | — | Links back to This week |

## 4. Global elements

- **Header:** wordmark (links to This week), a Home control, and a Cinemas link.
- **Home:** one saved point (lat/lng), stored only on the device. All distances and the map rings are measured from it.
  - **The Home pill opens a sheet** with "Use my current location" as the main option (the browser asks for permission once), or tap the map to drop a pin, then "Save home here". The same sheet clears it.
  - **If location permission is denied,** say so in the sheet and point to tapping the map or Settings. Never fail silently (this fixes a current backlog bug).
  - **With no home set,** show neighbourhood names instead of distances, draw no rings, and order the Cinemas list A–Z.
  - It is not live location: the users plan from elsewhere for trips that start at home. A "distance from where I am now" mode is deferred.
- **Seen films:** toggled on the film page. Seen films move into a collapsed "Seen (n)" group at the end of each list. They are never hidden outright. Stored locally.
- **My cinemas:** starred on the Cinemas index or a cinema page. Shown as a ★ next to cinema names and as filled dots on maps. They come first among a film's cinemas and in the Cinemas list. There is no list filter (see 9). Stored locally.
- **Footer:** data freshness, stated positively ("Updated 2 h ago"), the VO-only note, TMDb attribution, and a Privacy link. Signal stale data when the refresh has failed: a `--wash` notice under the list title ("Listings last updated Thu 2 Oct. Times may have changed, so check with the cinema before you go."), and the footer age switches to the real age.

## 5. Page requirements

### 5.1 This week (`/`)
- **Title:** "This week", the date range and the film count.
- **Sticky timetable header:** a "Week" cell, then one column per day in the horizon. Each column heading links to that day's Day view. A day with nothing on is dimmed (see 7.3 for how this differs from not yet published).
- **Sections:**
  1. **Only a few showings:** films with 3 or fewer remaining showings this week, soonest first. These are the ones that need planning around.
  2. **Playing all week:** the rest, ordered by number of showings (a stand-in for how big a release it is).
  3. **Seen (n):** collapsed.
- **Film row:**
  - Poster, title, rating · up to 2 genres · runtime.
  - One cell per day, aligned under the header. A filled cell shows that day's showing count and links to the film page on that day.
  - A summary line saying where:
    - single showing: "Tue 6, 18:30 · Glòries · 3.1 km";
    - otherwise: "N showings · M cinemas · nearest Verdi 250 m";
    - with 2 or fewer cinemas: name the cinemas.
- Counts and cells exclude showings that have already started.

### 5.2 Day
- Same header and strip. The selected day is highlighted, and "Week" returns to This week.
- **Rows:** poster, title, meta, then showtime chips (time, plus short cinema name and distance). Sorted by first remaining start time, then by distance.
- **Chips:** up to 4 on mobile (horizontal scroll) or 7 on desktop (wrapping), then "+N more", which links to the film page on that day.
- Tapping a chip opens the ticket sheet without leaving the list.
- Today drops showings that have already started.

### 5.3 Film
- **Hero:** backdrop, a back link ("‹ This week", or the referring cinema), the poster, title, rating, year, runtime and genres.
- **About:** tagline, synopsis (clamped to 3 lines with "More" on mobile, in full on desktop), director and the first 4 cast members.
- **Actions:** Trailer, Seen it, IMDb, Letterboxd.
- **Showtimes panel:**
  - **Day strip:** opens on the first day with remaining showings, unless `?day=` says otherwise.
  - **One row per cinema,** ordered favourites first, then by distance. Each row shows the cinema name (★ if a favourite, linking to its page), neighbourhood · distance, then a wrapping row of time chips. A chip shows the time plus an IMAX or subtitle tag. Each chip opens the ticket sheet, where the Book button is. Showings that have started are dimmed, not removed.
  - A big release on a busy day is about 11 cinema rows rather than 38 flat rows. This follows the "day → cinema → showing" grouping rule.
  - **"Where, <day>":** a map of the cinemas showing it that day, each labelled with its first time and "+n".
  - **No showings left:** the film's details stay, and the panel says "No more showings" with a link to This week. No day strip, no map. This happens late on a film's last day, between refreshes, and for films that have left the listings (see 7.6).
- **Layout:** on mobile, the day's showtimes should be reachable without scrolling past more than the clamped synopsis. On desktop, the panel is a sticky card beside the film info.

### 5.4 Cinema
- **Header:** name, address · neighbourhood · distance from home; actions Add to my cinemas, Website ↗, Directions ↗.
- **Locator map:** the cinema, home, and nearby cinemas dimmed, to help remember which cinema is which.
- **Programme:** the same timetable as This week (Week column plus 7 day columns), scoped to this cinema.
  - **Week view:** one row per film with cells counting its showings here each day, and "Next: Mon 5 18:00". Films are ordered by showing count; seen films go last and are faded. A cell links to that day's view, scrolled to the film.
  - **Day view:** one row per film with time chips (with tags) that open the ticket sheet.
  - **Empty day:** "Nothing on at <cinema> on <day>".

### 5.5 Cinemas
- **Map:** framed on cinemas within about 4 km of home, or all of them when there's no home. District names and rings are shown. Cinemas outside the frame are pinned to the edge with name, distance and "→". Each dot links to its cinema page.
- **List:** "My cinemas" first, then the rest by distance (A–Z with no home). Each row: name, neighbourhood · distance · "N films this week", and a star toggle.
- **Desktop:** the map is sticky on the left, the list on the right.

### 5.6 Ticket sheet
Opened from any showtime. A bottom sheet on mobile, a centred card on desktop. It closes on backdrop tap, Esc, swipe down or Back.
- **Stub:** poster and title.
- **Facts:** Date, Starts, and "Out ~", estimated as start + runtime + 15 min, or + 110 min when the runtime is unknown.
- **Where:** cinema name (links to the cinema page) and address · neighbourhood · distance. No map; the film page has already shown where it is.
- **Primary action:** "Book at <cinema> ↗" when there's a booking link. Otherwise "<cinema> website ↗", plus the note "No direct booking link for this showing".
- **Stub:** shows runtime · IMAX · subtitle version, listing only what applies.
- **Secondary actions:** "Share" (the system share sheet with "Aftersun · Verdi · Thu 9, 21:30" plus a link to the film page; copies the text where sharing isn't available) and "Directions ↗".
- Opening the sheet must give visible feedback immediately. This fixes the current "dead tap" bug.

## 6. Showing facts

| Fact | Source | Display |
|---|---|---|
| Time | `time` | 24 h, tabular figures |
| Cinema | `theater_id` | Short name in chips, full name elsewhere |
| Distance | home + cinema lat/lng | "250 m" (rounded to 50 m) under 1 km, then "1.5 km"; neighbourhood if no home |
| Subtitle version | `audio_lang` / `subtitle_lang` | Only for non-English audio: "English subs" / "Spanish subs" / "Catalan subs". English audio is the site's norm, so it gets no badge. Unknown gets no badge either (see `CONTEXT.md`) |
| Premium format | `premium_format` | "IMAX" tag on chips and in the ticket sheet; " · IMAX" on the This week summary line |
| Booking | `booking_url` | Book (primary) or the cinema website (fallback). Live data on 2026-10-04: 445 of 502 showings (89%) had a link; Phenomena, Filmoteca, Maldà and Maquinista had none |

## 7. Data and time rules

1. **Rendering time:** all time-relative output (today, past showings, data age) is computed against a clock that starts at render time and switches to the live clock after load. Server and client must agree. All rendering uses the Europe/Madrid timezone.
2. **Horizon:** always 7 columns, today plus 6 days.
3. **Not published yet vs nothing on:**
   - Late-week days are often thin because listings haven't been published yet. Don't present that as "no screenings".
   - A day after the last date any cinema has published counts as not out yet. It gets a dashed outline in strips, hatched timetable cells, the page message "<Day>'s listings aren't out yet", and "Sat listings not out yet" in the This week subtitle.
   - A published day with nothing left (today, once every showing has started) shows "Nothing left today", with a link back to the week.
4. **Missing data:**
   - missing poster → a placeholder: a paper-to-wash gradient with the title set in Playfair `--ink`;
   - missing backdrop → a short wash-gradient band in place of the hero;
   - missing runtime → omit it, and use 110 min for "Out ~";
   - missing coordinates → no map dot and no distance; show the neighbourhood instead.
5. **Sharing:** `og:description` must not contain the synopsis. Use title · year · genres. A share of a showing reads like "Aftersun · Verdi · Thu 21:30".
6. **Film pages outlive the run.** A shared or bookmarked film link must not hit the 404. Keep rendering a film's page for 30 days after its last listed showing, in the "No more showings" state, then drop it. This needs a backend change: today's data only holds films that are currently listed, so the renderer has no record of ones that just ended.

## 8. Non-functional

- **Performance budget per page:**
  - HTML ≤ 60 KB gzip for This week;
  - CSS ≤ 15 KB gzip;
  - JS ≤ 20 KB gzip on top of the shared runtime (a smaller runtime is preferable);
  - LCP ≤ 1.5 s on an iPhone over 4G;
  - CLS < 0.02.
  - Images: lazy-load posters below the fold, set explicit width and height, and serve sizes suited to the slot.
- **No third-party requests** other than TMDb images. Maps are local SVG; no tile servers.
- **Content Security Policy:** no inline `style` attributes; inline scripts only if hashed. This shapes components: no per-element computed styles. Use classes and SVG attributes.
- **Accessibility:**
  - WCAG AA contrast;
  - touch targets ≥ 44 px in both dimensions (the visual element can be smaller if its hit area isn't);
  - real links for navigation and buttons for actions;
  - visible focus;
  - honour `prefers-reduced-motion`;
  - maps get a text label, and everything on a map is also available in a list.
- **Browsers:** current and previous iOS Safari; current desktop Safari, Chrome and Firefox.
- **Navigation:** full page loads between pages, with the back/forward cache working and cross-document view transitions where supported.
- **Light theme only** for v1.

## 9. Out of scope (decided)

- Search: the list is short enough to scan.
- Watchlist: "Seen" covers the real need.
- Tonight-first framing and a "Walkable tonight" mode: superseded by the week view, distance shown everywhere, and maps.
- The "My cinemas" filter on the list: cinema pages answer "what's on at Verdi", and favourites already sort first. Cutting it removes a URL flag, the only first-paint reshuffle, and an empty state.
- The By Cinema view: replaced by cinema pages and the Cinemas index.
- The calendar (`.ics`) export: neat but rarely useful. Share replaces it in the ticket sheet.
- Dark mode (v1), accounts, analytics, reviews, public features.

## 10. Decisions log

| Date | Decision |
|---|---|
| 2026-10-04 | Favourite cinemas order first within a film's cinema rows, and win ties between equal times elsewhere. They don't reorder films. |
| 2026-10-04 | No "new this week" marker until the backend records when each film first appeared (`firstSeen`, in the backlog). |
| 2026-10-04 | Straight-line distance is good enough; no metro-stop reasoning. |
| 2026-10-04 | The Gràcia map cluster stays as it is for v1; the list under the map always names every cinema. |
| 2026-10-04 | The cinema page uses the week timetable, not a single-day strip. |
| 2026-10-04 | Drop the calendar export. Keep geolocation, but only to set Home. Keep subtitle badges for non-English audio. Keep IMAX. |
| 2026-10-04 | Cut the My cinemas list filter and the ticket-sheet map. Add the film page's "No more showings" state and keep film pages for 30 days after the run. Book stays the primary action: 89% of live showings have a booking link. |

## 11. Open questions

New ones go here. Raised 2026-10-04 by checking the spec against the live data (`generated_at` 2026-10-04T08:19Z: 38 films, 502 showings, 17 cinemas):

1. **"Not out yet" (7.3) doesn't fire on real data.** The rule is "after the last date any cinema has published". Live, most cinemas publish through Thu 8, but Fri 9 has 9 showings and Sat 10 has 14, mostly one-off previews (Girona, Maquinista, Filmoteca, and single late showings at Diagonal, Arenas, Renoir, Verdi Park). The last published date is therefore Sat 10, so no day counts as not out yet, and Fri and Sat look like genuinely quiet days. *Proposal:* a day is not out yet when fewer than half of the cinemas showing something today have any showing on it (Fri 9: 5 of 15; Sat 10: 7 of 15). The few showings that are out still appear as filled cells and chips. Only the empty cells get the hatch. Subtitle copy: "Fri and Sat listings mostly not out yet". **Resolved 2026-10-04:** proposal accepted.
2. **Personalisation vs first paint.** Home, Seen and My cinemas live in `localStorage`, so the pre-rendered HTML can't know them. Under the hydration-parity rule, the first paint shows the "no home, nothing seen" version. Then, on every page load: seen rows jump into the Seen group, the film page's cinema rows re-sort (favourites first, then distance), and neighbourhoods turn into distances. Both users always have all three set. That conflicts with principle 6, "no layout shift after load", and with the CLS < 0.02 budget. The decision log says cutting the My cinemas filter removed "the only first-paint reshuffle", which isn't the case. Options are in the build plan; this needs a decision. **Resolved 2026-10-04:** read prefs after mount and measure CLS; the Home pill label is set by a pre-paint class.
3. **"Only a few showings" dominates.** Live, 22 of 38 films have 3 or fewer showings, many of them repertory one-offs (Drive, Boogie Nights, A Streetcar Named Desire). In the prototype fixture it was 8 of 22. So the "plan around these" section is longer than "Playing all week". Keep the threshold of 3 and re-judge it on the built page?
4. **Subtitle tags will almost never show.** Live: 366 showings have English audio, 136 unknown, and 0 non-English. Every `subtitle_lang` is `es` or absent. With the 6 rule (no badge for English audio), no chip carries a subtitle tag today. That's fine, but `CONTEXT.md` still says English audio gets an "English" badge. Update `CONTEXT.md` to match 6.
5. **Film URLs.** 3 says `/film/<slug>/`. Live film ids are TMDb ids (`/film/1248832`), with a title slug only when there's no TMDb id. Keeping ids means existing bookmarks keep working and titles can change safely. **Resolved 2026-10-04:** keep ids, path URLs.
6. **Dangling reference.** Guidelines 5 cites "requirements Q5" (map pan/zoom), which doesn't exist here. Pan/zoom is out of scope for v1.
7. **Safari can wipe the device state.** WebKit deletes a site's `localStorage` after 7 days of Safari use without visiting it, unless the site was added to the Home Screen. If they skip a week, Home, Seen and My cinemas reset. Worth a line on the Privacy page, and maybe a suggestion to add the site to the Home Screen?
