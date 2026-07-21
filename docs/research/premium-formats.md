# Premium large-format & 3D screenings across providers

Research note for issue #42. Investigates which premium large-format (IMAX,
iSense, ScreenX, 4DX, Dolby Cinema, Phenomena big-screen, Yelmo premium…) and
3D screenings actually exist upstream, how each provider exposes them, the
extraction cost, and how many survive the English/VO filter.

**Method.** Read the provider source in `providers/`, then probed the live
upstream feeds each provider actually scrapes (SensaCine JSON API,
englishcinemabarcelona.com, moobycinemas.com). Findings tagged
**[verified-source]** (from repo code), **[verified-live]** (from a live upstream
probe on 2026-07-24…07-30), or **[inferred]**.

## TL;DR

- **Today the pipeline tracks zero premium/3D format.** A codebase-wide grep for
  `imax|isense|screenx|4dx|dolby|3d|premium|atmos` finds only the code that
  *strips* an IMAX badge, plus its test. No `Showtime`/`Movie` field carries
  format (`models.py:4-35`). **[verified-source]**
- **The one place premium format actually flows through the English/VO filter
  today is Cinesa via SensaCine — and it's discarded.** SensaCine's JSON exposes
  format **inline, per showtime, for free** (`projection: ["IMAX"]` +
  `tags: ["Format.Projection.Imax"]`). The provider reads `tags` only for the
  subtitle prefix and ignores the format tag. **[verified-live]**
- **The ticket's premise that Cinesa format needs an extra request per showtime
  is FALSE for this repo.** That is true of the retail `cinesa.es`
  `/compra/butacas/?showtimeId=…` page, but this repo does not scrape cinesa.es
  — it reads Cinesa listings from the SensaCine aggregator JSON, where the format
  tag is already in the response the provider parses. **No extra HTTP request.**
  **[verified-live]**
- **English-VO premium volume is low and event-driven.** Across the current week
  (2026-07-24…07-30) the only English-VO premium showtimes in the entire catalog
  were **11 IMAX showtimes at Cinesa Diagonal Mar, all of a single film**
  ("The Odyssey" / "La Odisea", a Nolan IMAX-shot tentpole). Zero iSense /
  ScreenX / 4DX / Dolby / 3D English-VO showtimes anywhere. **[verified-live]**

## Provider → cinema → format map

| Provider (`providers/…`) | Cinemas it feeds | Premium formats physically present | 3D? |
|---|---|---|---|
| `listings_provider.py` (englishcinemabarcelona.com) | Yelmo Maquinista, Filmax, Verdi/VP, Maldà, Girona, RenFlo, EspaiTexas, Sarrià, Zumzeig, and Cinesa/Yelmo entries ECB lists | IMAX (Yelmo/Cinesa big screens), Filmax has a 3D/Atmos hall | Occasionally |
| `sensacine_provider.py` (sensacine.com JSON) | Cinesa Diagonal, **Diagonal Mar (IMAX site)**, SOM; Phenomena; plus Verdi/VP + all Mooby as duplicates | IMAX at Diagonal Mar; iSense/4DX/Dolby capacity at some Cinesa | Yes (as a version bucket) |
| `secondary_provider.py` (moobycinemas.com `window.shops`) | Mooby Glòries, Aribau, Arenas, Balmes, Bosque, Sarrià | None (arthouse-ish multiplex) | None found |
| `verdi_provider.py` (cines-verdi.com + admit-one) | Verdi, Verdi Park | None (arthouse) | None |

Phenomena is nominally in `_SENSACINE_IDS` (`sensacine_provider.py:37`, `E0544`)
but its SensaCine feed returned **0 results** on probe — the big-screen "Experience"
cinema effectively contributes nothing through the current pipeline. **[verified-live]**

## Per-provider detail

### 1. `listings_provider.py` — IMAX badge present inline, currently STRIPPED

**[verified-source]** The showtime badge markup is documented in the code and its
test. Comment at `providers/listings_provider.py:62-65`:

```
<a ...><i class="fi-clock ..."></i><strong>18:00</strong> Yelmo Icaria</a>
```

Test fixture at `tests/test_listings_provider.py:56`:

```html
<a><strong>18:00</strong> Glòries<span class="badge">IMAX</span></a>
```

So the premium designation rides as a trailing `<span class="badge">IMAX</span>`
sibling after the cinema-name text node. `_extract_cinema_name`
(`providers/listings_provider.py:59-79`) walks the badge children and keeps only
`NavigableString` nodes after `<strong>`, explicitly skipping child tags "so they
don't pollute the cinema name" (line 65). **The IMAX span is parsed and thrown
away; it is never stored on the `Showtime`.**

- **Exposure:** inline in the already-fetched listings HTML.
- **Cost:** **free** — one string node in the badge already in hand.
- **Filter survival:** the listings feed is English-only by construction (every
  row's poster alt ends `"…in English at cinemas in Barcelona"`,
  `listings_provider.py:29,122`), and all its showtimes are hardcoded
  `language="vo"` (line 154). So **any** IMAX badge on this feed is already an
  English-VO premium showtime. Live volume for this feed is **[inferred]**: the
  live table is served from a secret `LISTINGS_FEED_URL` (SSM) and the public
  homepage is JS/Cloudflare-gated, so I could not count live badges. The
  Yelmo-Icaria example in the code comment and the IMAX test fixture confirm the
  feed does surface IMAX badges for its big-screen entries.

### 2. `sensacine_provider.py` — format is inline & free; the "extra request" premise is wrong

**[verified-live]** SensaCine's per-theater-per-day JSON
(`https://www.sensacine.com/_/showtimes/theater-{id}/d-{date}/`,
`sensacine_provider.py:86`) returns, for every showtime, these format-bearing
fields (observed keys): `experience`, `comfort`, `projection`, `picture`,
`sound`, `tags`, `diffusionVersion`.

Observed values (Cinesa Diagonal/Diagonal Mar/SOM, 2026-07-24):

- Standard showtime: `projection: ["DIGITAL"]`, `tags: ["Format.Projection.Digital", …]`
- **IMAX showtime (Diagonal Mar):** `projection: ["IMAX"]`,
  `tags: ["Format.Projection.Imax", "Localization.Version.Original",
  "Localization.Subtitle.Spanish"]`, movie title
  `"La Odisea: The IMAX Experience"`.
- `experience`, `picture`, `sound` were `null` in every sample — 4DX / Dolby
  Cinema / ScreenX would presumably surface here (or as further `Format.*` tags)
  but none were scheduled this week. iSense would appear as another
  `projection`/`Format.Projection.*` value; none seen.

The provider **already fetches and JSON-parses this exact response** and iterates
`st.get("tags")` — but only to find the `Localization.Subtitle.` prefix
(`sensacine_provider.py:42,73-77,129`). It reads neither `projection` nor the
`Format.Projection.Imax` tag. So **the format is one dict lookup away, at zero
added cost.**

- **Exposure:** `projection` field and/or `Format.Projection.*` tag, inline.
- **Cost:** **free** — same response already parsed. **Contradicts the ticket's
  "one extra request per showtime like the Verdi sala lookup" cost model.** That
  cost model describes scraping `cinesa.es` directly; this repo does not.
- **Filter survival:** the provider keeps only the `original` version bucket
  (`sensacine_provider.py:114-116`) and only movies whose `languages` include
  `ENGLISH` (lines 107-110). The probed IMAX showtime was in the `original`
  bucket with `ENGLISH` audio, so **it passes the filter and is published today —
  minus its format tag.**

### 3. `secondary_provider.py` (Mooby) — no premium format, no 3D

**[verified-live]** Probed `moobycinemas.com/glories`'s `window.shops` payload
(the exact structure `secondary_provider.py:18,111-168` parses). Scanned all
event `name` values: **zero** `3D`, `IMAX`, `Dolby`, or `Atmos` in event names.
(`Dolby`/`Atmos` strings appear elsewhere on the page as house sound-system
boilerplate, not per-showtime format.) The event model exposes only
`name`, `language`, `subtitles_lang`, `performances` — no format field.

- **Exposure:** none. **Cost:** n/a. **Filter survival:** n/a — Mooby cinemas
  are standard multiplexes with no premium large format; nothing to capture.

### 4. `verdi_provider.py` — no premium format

**[verified-source]** Verdi/Verdi Park are two-screen arthouse houses. The film
page's showtime buttons carry only `<time>` + a `<small>` language label
(`CASTELLÀ` / `V.O.`, regex at `verdi_provider.py:38-42`). The admit-one seat-page
lookup (`verdi_provider.py:101-119`) exists **only** to disambiguate Verdi vs
Verdi Park by sala label — not format. No premium designation exists upstream.

## English-VO premium volume (the gating question)

**[verified-live]** Counted IMAX showtimes at Cinesa Diagonal Mar (E0382, the
only IMAX-capable site in the catalog) for the full current week:

| Date | IMAX showtimes | English-VO IMAX |
|---|---|---|
| 2026-07-24 | 3 | 1 |
| 2026-07-25 | 4 | 2 |
| 2026-07-26 | 4 | 2 |
| 2026-07-27 | 3 | 1 |
| 2026-07-28 | 3 | 2 |
| 2026-07-29 | 3 | 2 |
| 2026-07-30 | 3 | 1 |
| **Week** | **23** | **11** |

All 11 English-VO IMAX showtimes were the **same film** ("The Odyssey" /
"La Odisea: The IMAX Experience"). Across Diagonal, SOM, and Phenomena: **zero**
English-VO premium showtimes. Zero iSense / ScreenX / 4DX / Dolby Cinema / 3D
English-VO showtimes anywhere in the probed set.

**Magnitude verdict:** roughly **a dozen English-VO premium showtimes per week —
but entirely event-driven by a single IMAX-shot tentpole in release, and
essentially zero in weeks without one.** Premium format in this catalog is a
"big Hollywood IMAX release is currently playing" signal, concentrated at one
cinema (Cinesa Diagonal Mar) plus whatever IMAX badge ECB surfaces for Yelmo.

## Recommendation for #42

- **Cheapest win, if pursued:** capture `projection` / `Format.Projection.*` in
  `sensacine_provider.py` and the stripped `<span>` in `listings_provider.py`.
  Both are **free** (already-parsed data), needing one new optional `Showtime`
  field (`models.py`) threaded through `transform.py` + `src/types.ts`.
- **Do NOT** build per-showtime butacas requests for Cinesa — unnecessary; the
  format is already inline in the SensaCine JSON.
- **Honest cost/benefit:** the feature lights up ~a dozen showtimes/week of one
  film at one cinema during tentpole windows, and goes dark otherwise. It earns
  its keep only as a near-free "IMAX" badge on the ~2 providers that already
  carry it inline — not as anything requiring extra fetches.
