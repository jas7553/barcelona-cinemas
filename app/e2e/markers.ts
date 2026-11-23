/**
 * Attributes the renderer puts in its HTML so the checks can tell what an
 * element is. Each is a bare boolean attribute.
 */

/**
 * One showing: the element holding its time link and cinema. With JavaScript
 * off, a listings page must have at least one, each with an http(s) link
 * around a `<time>` (checks/no-js.ts).
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
