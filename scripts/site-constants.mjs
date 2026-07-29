// Single owner for the build-time facts that used to be hand-copied across four
// dialects (package.json scripts, CloudFormation YAML, S3 key prefixes, POSIX
// paths). Every one of them failed *silently* in production when it drifted, so
// each fact is declared exactly once here and every sink derives its own form.
//
// This module is imported at runtime by both renderers, so it ships with the
// SSG Lambda — see ssg-lambda/Makefile and the staging copies in deploy.sh.

/**
 * The one timezone every render path must resolve to.
 *
 * Showtimes are bucketed into days by local wall-clock time. A renderer running
 * in another zone buckets a 00:30 screening into the wrong day, and the baked
 * HTML then disagrees with the client's hydration render — an invisible failure
 * that only shows up as wrong dates on the live site.
 *
 * Sinks that can import this constant do (vite.config.ts, playwright.config.ts,
 * the two renderers via assertSiteTimezone). Sinks that cannot — package.json's
 * `build` script, template.yaml's SsgFunction env, entry-server.tsx's
 * madridOffset — are covered by scripts/site-constants.test.mjs, which fails if
 * their literal ever stops matching this value.
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
 * Per-film output locations the render prune is allowed to sweep, each paired
 * with the only file extension it may delete there.
 *
 * Canonical form: no leading and no trailing slash. Each sink normalises:
 *   - filesystem (scripts/render.mjs) joins it with path.join
 *   - S3 (ssg-lambda/index.mjs) needs a TRAILING SLASH, because ListObjectsV2
 *     matches a literal prefix and a bare `film` would also match `filmy/…`
 *     while `film/` correctly excludes `data/film/` (which needs its own pass)
 *   - template.yaml scopes s3:DeleteObject to `<prefix>/*` for the same two
 *
 * Widening this widens a delete permission. Don't.
 */
export const PRUNE_PREFIXES = Object.freeze([
  Object.freeze({ prefix: "film", ext: ".html" }),
  Object.freeze({ prefix: "data/film", ext: ".json" }),
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
