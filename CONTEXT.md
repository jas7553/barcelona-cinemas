# Barcelona Movie Database — Context

Domain language for the listings pipeline: how raw cinema feeds become the
deduplicated, enriched movie data served to the SPA.

## Language

**Listings**:
The cached top-level payload — `fetched_at`, `stale`, and a list of **Movies**.

**Movie**:
One film, identified across feeds by its **canonical key**, carrying its
**Showtimes** plus enrichment metadata.

**Showtime**:
One screening of a **Movie** at one **Cinema** on a date/time, in a language
(`vo` | `dub`), optionally with a booking link.

**Provider**:
A source of raw **Movies** scraped from one upstream feed. Implements
`ListingsSource.fetch`.
_Avoid_: scraper, source adapter (when you mean the concept, say Provider).

**Enrichment**:
Filling a **Movie**'s metadata (poster, year, rating, runtime, genres) from
TMDb. Runs after **Reconciliation**.

**Reconciliation**:
Collapsing many raw **Movies** into one per identity — picking the display
title, coalescing non-null fields, and deduping **Showtimes** while preserving
booking links. The single home for "are these the same film, and how do we
merge them."
_Avoid_: merge, dedup, combine (these name steps inside Reconciliation, not
the concept).

**Same-movie**:
The identity test for Reconciliation, a pairwise predicate: two **Movies** are
the same film if both carry an `imdb_id` and they are equal, otherwise if their
normalized titles are equal. Not a single key — a **Movie** with an imdb still
matches a same-title **Movie** that lacks one (different Providers disagree on
imdb presence).

**Cinema**:
A venue in the registry (`cinemas.json`). Its registry key equals
`Showtime.cinema`; its `id` is the public **Theater** identifier (1:1 with the
key).
_Avoid_: theater (internal), venue.

## Relationships

- A **Provider** emits raw **Movies**; **Reconciliation** collapses them by the
  **same-movie** test into one **Movie** each.
- **Reconciliation** runs *before* **Enrichment**, so it arbitrates only
  provider-known fields (title, imdb_id) plus **Showtimes**.
- A **Movie** has many **Showtimes**; each **Showtime** names one **Cinema**.
- The public API renames **Cinema** → Theater via its `id`.

## Example dialogue

> **Dev:** "Two **Providers** both list Dune — when do we merge them?"
> **Domain expert:** "At **Reconciliation**, by the **same-movie** test. Equal
> `imdb_id` when both have one, else equal normalized title. We merge their
> **Showtimes** and keep whichever copy has the booking link."
> **Dev:** "And the TMDb poster?"
> **Domain expert:** "That's **Enrichment**, and it runs after — so
> Reconciliation never sees a poster to arbitrate."

## Flagged ambiguities

- "merge" was used for three distinct things — cross-Provider movie merge,
  intra-feed accumulation, and output showtime dedup. Resolved: all three are
  **Reconciliation**; the verbs (merge/dedup) name internal steps only.
- "theater" vs "cinema" — resolved: **Cinema** internally, Theater only in the
  public API shape.
