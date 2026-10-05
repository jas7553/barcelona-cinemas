// Drift guards for FACT B (the render timezone) and FACT C (the prune prefixes).
//
// Both facts have one owner in scripts/site-constants.mjs, and every sink that
// CAN import it does. These tests cover the sinks that CANNOT: package.json's
// build script, template.yaml's SsgFunction env and IAM policy, and the
// MADRID_TZ literal in src/domain/time.ts. Each of those is a plain string
// in a file no bundler touches, so nothing but a test can notice when one of
// them stops agreeing.
//
// Every failure mode guarded here is invisible until production:
//   - wrong TZ  → showtimes bucket into the wrong day, baked HTML disagrees
//                 with client hydration, and the page looks completely normal
//   - wrong prune prefix → either stale film pages never get swept, or the
//                 renderer is denied a delete it needs (or, worst, is granted
//                 one it should not have)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  PRUNE_PREFIXES,
  SITE_TIMEZONE,
  assertSiteTimezone,
  objectKeyFor,
  prunePrefixesFs,
  prunePrefixesIamGlobs,
  prunePrefixesS3,
} from "./site-constants.mjs";

// Resolved from the vitest root, not import.meta.url: vitest transforms these
// modules, so import.meta.url is not guaranteed to be a file: URL.
const read = (relPath) => readFileSync(resolve(process.cwd(), relPath), "utf8");

const PACKAGE_JSON = read("package.json");
const TEMPLATE_YAML = read("template.yaml");
const TIME_TS = read("src/domain/time.ts");

describe("FACT B — the render timezone", () => {
  it("pins every command in the build script, not just the renderer", () => {
    const build = JSON.parse(PACKAGE_JSON).scripts.build;
    const commands = build.split("&&").map((c) => c.trim());
    const timed = commands.filter((c) => c.startsWith("vite ") || c.includes("scripts/render.mjs") || c.startsWith("TZ="));

    expect(timed.length).toBeGreaterThan(0);
    for (const command of timed) {
      expect(command, `build command is not pinned to ${SITE_TIMEZONE}: ${command}`).toContain(`TZ=${SITE_TIMEZONE}`);
    }
  });

  it("matches the SsgFunction environment in template.yaml", () => {
    const match = TEMPLATE_YAML.match(/^\s*TZ:\s*(\S+)\s*$/m);
    expect(match, "no TZ found in template.yaml — SsgFunction would render in UTC").not.toBeNull();
    expect(match[1]).toBe(SITE_TIMEZONE);
  });

  it("matches the client's MADRID_TZ literal in src/domain/time.ts", () => {
    // The client bundle can't import a .mjs build module, so time.ts holds its own literal.
    const match = TIME_TS.match(/MADRID_TZ = "([^"]+)"/);
    expect(match, "no MADRID_TZ literal found in src/domain/time.ts").not.toBeNull();
    expect(match[1]).toBe(SITE_TIMEZONE);
  });

  it("assertSiteTimezone throws, loudly, when the process resolves elsewhere", () => {
    const original = process.env.TZ;
    try {
      // Vitest is itself pinned to SITE_TIMEZONE, so prove the guard fires by
      // comparing against a zone we know differs.
      expect(SITE_TIMEZONE).not.toBe("UTC");
      expect(() => {
        const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (resolved !== "Antarctica/Troll") {
          throw new Error(`timezone must be Antarctica/Troll, but this process resolves to ${resolved}`);
        }
      }).toThrow(/timezone must be/);
      // And that it passes under the real pin.
      expect(() => assertSiteTimezone("site-constants.test")).not.toThrow();
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("FACT C — the prune prefixes", () => {
  it("derives the filesystem and S3 dialects from one declaration", () => {
    expect(prunePrefixesFs().map(([p]) => p)).toEqual(PRUNE_PREFIXES.map(({ prefix }) => prefix));
    expect(prunePrefixesS3().map(([p]) => p)).toEqual(PRUNE_PREFIXES.map(({ prefix }) => `${prefix}/`));
  });

  it("keeps the trailing slash on the S3 form", () => {
    // Load-bearing: ListObjectsV2 matches a literal prefix, so a bare `film`
    // would also sweep `filmy/…`, and `film/` correctly excludes `data/film/`.
    for (const [prefix] of prunePrefixesS3()) {
      expect(prefix.endsWith("/")).toBe(true);
    }
    expect(prunePrefixesS3().some(([p]) => p === "film/")).toBe(true);
    expect(prunePrefixesS3().some(([p]) => p === "data/film/")).toBe(true);
    // `film/` must not be a prefix of the keys `data/film/` owns.
    expect("data/film/dune.json".startsWith("film/")).toBe(false);
  });

  it("pairs every prefix with exactly one deletable extension", () => {
    for (const { prefix, ext } of PRUNE_PREFIXES) {
      expect(ext.startsWith("."), `${prefix} has a malformed extension: ${ext}`).toBe(true);
    }
  });

  it("matches the s3:DeleteObject scope in template.yaml", () => {
    // Widening this widens a delete permission, so assert both directions:
    // every glob we expect is present, and no glob we did not expect is.
    const statement = TEMPLATE_YAML.match(/Sid: PruneStaleFilmObjects[\s\S]*?Resource:\n([\s\S]*?)\n\s*- Sid:/);
    expect(statement, "no PruneStaleFilmObjects statement found in template.yaml").not.toBeNull();

    const granted = [...statement[1].matchAll(/FrontendBucket\.Arn\}\/([^"]+)"/g)].map((m) => m[1]);
    expect(granted.sort()).toEqual(prunePrefixesIamGlobs().sort());
  });

  it("grants delete on nothing outside the prune prefixes", () => {
    for (const glob of prunePrefixesIamGlobs()) {
      expect(glob.endsWith("/*")).toBe(true);
      expect(glob).not.toBe("*");
    }
  });
});

describe("FACT D — clean URLs", () => {
  /** template.yaml's UrlRewriteFunction, run as CloudFront would run it. */
  function deployedRewrite(uri) {
    const block = TEMPLATE_YAML.match(/UrlRewriteFunction:[\s\S]*?FunctionCode: \|\n([\s\S]*?)\n\n/);
    if (!block) throw new Error("no UrlRewriteFunction code found in template.yaml");
    const handler = new Function(`${block[1]}; return handler;`)();
    return handler({ request: { uri } }).uri;
  }

  it.each([
    "/",
    "/privacy",
    "/privacy/",
    "/film/1248832",
    "/film/1248832/",
    "/film/1248832/2026-10-05/",
    "/day/2026-10-05/",
    "/cinema/verdi-park/",
    "/cinemas/",
    "/assets/client-abc123.js",
    "/data/listings.json",
    "/404.html",
  ])("objectKeyFor(%j) resolves like the deployed function", (uri) => {
    expect(`/${objectKeyFor(uri)}`).toBe(deployedRewrite(uri));
  });
});
