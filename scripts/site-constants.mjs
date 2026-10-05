// Build-time facts with one owner; each sink derives its own form. Ships with
// the SSG Lambda (ssg-lambda/Makefile).

/**
 * The one timezone every render path must resolve to.
 *
 * Showtimes are bucketed into days by local wall-clock time. A renderer running
 * in another zone buckets a 00:30 screening into the wrong day, and the baked
 * HTML then disagrees with the client's hydration render — an invisible failure
 * that only shows up as wrong dates on the live site.
 *
 * Sinks that can't import it (package.json `build`, template.yaml SsgFunction,
 * src/domain/time.ts) are checked by site-constants.test.mjs.
 */
export const SITE_TIMEZONE = "Europe/Madrid";

/**
 * Fail loudly if the current process is not resolving dates in SITE_TIMEZONE.
 *
 * Called by both render entry points. This is deliberately a throw and not a
 * warning: a page rendered in the wrong zone is worse than no page at all,
 * because it looks completely normal and is simply wrong about what is on
 * tonight.
 *
 * @param {string} context  Where the check ran, for the error message.
 */
export function assertSiteTimezone(context) {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (resolved !== SITE_TIMEZONE) {
    throw new Error(
      `[${context}] timezone must be ${SITE_TIMEZONE}, but this process resolves to ${resolved} ` +
        `(TZ=${process.env.TZ ?? "unset"}). Showtimes would bucket into the wrong day and the ` +
        `baked HTML would disagree with client hydration.`,
    );
  }
}

/**
 * Film, day and cinema page locations the render prune is allowed to sweep, each paired
 * with the only file extension it may delete there.
 *
 * Canonical form: no leading and no trailing slash. Each sink normalises:
 *   - filesystem (scripts/render.mjs) joins it with path.join
 *   - S3 (ssg-lambda/index.mjs) needs a TRAILING SLASH, because ListObjectsV2
 *     matches a literal prefix and a bare `film` would also match `filmy/…`
 *     while `film/` correctly excludes `data/film/` (which needs its own pass)
 *   - template.yaml scopes s3:DeleteObject to `<prefix>/*` for the same prefixes
 *
 * Widening this widens a delete permission. Don't.
 */
export const PRUNE_PREFIXES = Object.freeze([
  Object.freeze({ prefix: "film", ext: ".html" }),
  // Legacy: nothing writes here now; drop once a deploy has swept it.
  Object.freeze({ prefix: "data/film", ext: ".json" }),
  Object.freeze({ prefix: "day", ext: ".html" }),
  Object.freeze({ prefix: "cinema", ext: ".html" }),
]);

/** Prune targets as POSIX-ish relative dirs, for the filesystem renderer. */
export function prunePrefixesFs() {
  return PRUNE_PREFIXES.map(({ prefix, ext }) => [prefix, ext]);
}

/** Prune targets as literal S3 key prefixes (trailing slash is load-bearing). */
export function prunePrefixesS3() {
  return PRUNE_PREFIXES.map(({ prefix, ext }) => [`${prefix}/`, ext]);
}

/** Prune targets as IAM resource suffixes, matching template.yaml's ARN globs. */
export function prunePrefixesIamGlobs() {
  return PRUNE_PREFIXES.map(({ prefix }) => `${prefix}/*`);
}

/**
 * The bucket key a request path is served from: the same mapping as the
 * CloudFront Function in template.yaml (UrlRewriteFunction). The dev server and
 * the e2e static server resolve URLs through this, so they route like
 * production; site-constants.test.mjs runs the deployed function against it.
 *
 * @param {string} uri  Request path, e.g. "/film/1248832/".
 * @returns {string}    Key without a leading slash, e.g. "film/1248832.html".
 */
export function objectKeyFor(uri) {
  if (uri === "/" || uri === "") return "index.html";
  const clean = uri.replace(/\/$/, "");
  const last = clean.slice(clean.lastIndexOf("/") + 1);
  return (last.includes(".") ? clean : `${clean}.html`).slice(1);
}
