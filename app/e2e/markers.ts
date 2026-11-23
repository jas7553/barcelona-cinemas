/**
 * Attributes the renderer puts in its HTML so the checks can tell what an
 * element is. Each is a bare boolean attribute.
 */

/**
 * One showing: the line holding its cinema icon, time and short cinema name.
 * With JavaScript off, a listings page must have at least one, each with an
 * http(s) link around a `<time>` (checks/no-js.ts).
 */
export const SHOWING = "data-showing";

/**
 * On a showing's `<a>` when it goes straight to a booking page. The brief
 * draws these without ↗; any other external link, including a showing's
 * fallback to the cinema's site, ends in ↗
 * (checks/external-links.ts). Only an external link around a `<time>` may
 * carry it.
 */
export const BOOKING = "data-booking";

/**
 * On a showing's cinema icon and name links to its Google Maps place page. The
 * brief draws these without ↗, since every showing has one. Only a Google Maps
 * link inside a SHOWING may carry it.
 */
export const PLACE = "data-place";

/**
 * On the external-arrow line icon (an `<svg>` or `<span>`), the alternative to
 * a trailing "↗" in the text: the link's last child, with no text after it.
 * The icon itself tells screen readers the link leaves the site, so it is an
 * image with a name: `role="img"` and a non-empty `aria-label` (or, on an
 * `<svg>`, a `<title>`), and never `aria-hidden` (checks/external-links.ts).
 */
export const EXTERNAL_ICON = "data-external-icon";

/**
 * On a container of the film's own words: title, tagline, synopsis. Their text
 * may look like a clock ("3:10 to Yuma", "at 9 a.m."), so checks/times.ts
 * skips it, though a `<time>` inside is still checked. It must not hold a
 * SHOWING.
 */
export const FILM_TEXT = "data-film-text";
