// Drift guard for FACT A: the CSP sha256 allowances.
//
// CloudFront's script-src carries one sha256 per inline <script> body. Nothing
// in the build computes them, dev serves no CSP at all, and the e2e suite runs
// against the Vite dev server — so a stale hash is invisible everywhere except
// production, where the browser silently refuses to run the script and the page
// just stops theming itself (or stops prerendering) with no error surfaced.
//
// scripts/template.mjs owns the script bodies. These tests derive the hashes
// from those bodies and fail if template.yaml disagrees.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  EXPIRED_REDIRECT_SCRIPT,
  INLINE_SCRIPTS,
  PREFS_SCRIPT,
  SPECULATION_RULES,
  cspScriptHashes,
  renderDocument,
} from "./template.mjs";
import { PREF_KEYS } from "../src/domain/prefs.ts";

// Resolved from the vitest root, not import.meta.url: vitest transforms these
// modules, so import.meta.url is not guaranteed to be a file: URL.
const TEMPLATE_YAML = readFileSync(resolve(process.cwd(), "template.yaml"), "utf8");

/** The `script-src …;` directive out of the CSP block scalar in template.yaml. */
function scriptSrcDirective() {
  // Skip YAML comments — the CSP block is preceded by prose that also says
  // "script-src", and matching that instead silently passes an empty hash set.
  const directive = TEMPLATE_YAML.split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
    .match(/script-src\s+([^;]*);/);
  if (!directive) throw new Error("no script-src directive found in template.yaml");
  return directive[1].trim();
}

function samplePage({ notFound = false } = {}) {
  return renderDocument({
    title: "t",
    headExtra: "",
    bodyHtml: "<main></main>",
    data: { a: 1 },
    entrySrc: "/assets/x.js",
    notFound,
  });
}

/** Bodies of the executable inline scripts in a document (inert data blocks excluded). */
function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => ({ tag: m[0], body: m[1] }))
    // Inert data blocks (the hydration payload, ld+json) are not executed, so
    // CSP never evaluates them and they need no allowance.
    .filter(({ tag }) => !/type="application\/(json|ld\+json)"/.test(tag))
    .map(({ body }) => body);
}

describe("CSP inline-script hashes", () => {
  it("has a hash in template.yaml for every inline script body", () => {
    const directive = scriptSrcDirective();
    const hashes = cspScriptHashes();
    for (const [name, hash] of Object.entries(hashes)) {
      expect(
        directive,
        `template.yaml script-src is missing the sha256 for ${name}.\n` +
          `Replace the stale allowance with: ${hash}\n` +
          `Current script-src: ${directive}\n` +
          `All current hashes:\n` +
          Object.entries(hashes)
            .map(([n, h]) => `  ${n}: ${h}`)
            .join("\n"),
      ).toContain(hash);
    }
  });

  it("carries no sha256 allowance that no longer matches a script we ship", () => {
    // The other direction: a leftover hash means an inline script was removed or
    // edited and the CSP was never tightened back up.
    const present = new Set(scriptSrcDirective().match(/'sha256-[^']+'/g) ?? []);
    const expected = new Set(Object.values(cspScriptHashes()));
    expect([...present].sort()).toEqual([...expected].sort());
  });

  it("covers exactly the inline scripts the rendered documents actually contain", () => {
    // Guards the case where someone adds an inline <script> to the template
    // but not to INLINE_SCRIPTS — the hash set above would still be "complete".
    const shipped = new Set([...inlineScripts(samplePage()), ...inlineScripts(samplePage({ notFound: true }))]);
    expect([...shipped].sort()).toEqual(Object.values(INLINE_SCRIPTS).sort());
  });
});

describe("pre-paint prefs script", () => {
  it("reads the same key the prefs store writes", () => {
    expect(PREFS_SCRIPT).toContain(`"${PREF_KEYS.home}"`);
  });
});

describe("404 document", () => {
  it("carries the expired-page redirect, ahead of everything else in <head>", () => {
    const html = samplePage({ notFound: true });
    expect(inlineScripts(html)[0]).toBe(EXPIRED_REDIRECT_SCRIPT);
    expect(inlineScripts(samplePage())).not.toContain(EXPIRED_REDIRECT_SCRIPT);
  });

  /** Where the redirect sends a path, or null when it leaves the 404 alone. */
  function redirectFor(pathname) {
    let target = null;
    new Function("location", EXPIRED_REDIRECT_SCRIPT)({
      pathname,
      replace: (to) => {
        target = to;
      },
    });
    return target;
  }

  it.each([
    ["/day/2026-09-30/", "/"],
    ["/day/2026-09-30", "/"],
    ["/film/1248832/2026-09-30/", "/film/1248832/"],
    ["/cinema/verdi-park/2026-09-30", "/cinema/verdi-park/"],
  ])("sends the expired page %s on to %s", (from, to) => {
    expect(redirectFor(from)).toBe(to);
  });

  it.each(["/film/1248832/", "/nope", "/day/", "/day/tomorrow/", "/film/1/2/2026-09-30/", "/privacy/"])(
    "leaves %s on the 404",
    (path) => {
      expect(redirectFor(path)).toBeNull();
    },
  );
});

describe("cspScriptHashes()", () => {
  it("derives from the body, so editing a script changes its hash", () => {
    // Sanity: the hashes are computed, not constants that happen to look right.
    expect(cspScriptHashes().PREFS_SCRIPT).toMatch(/^'sha256-[A-Za-z0-9+/]+={0,2}'$/);
    expect(cspScriptHashes().SPECULATION_RULES).not.toBe(cspScriptHashes().PREFS_SCRIPT);
    expect(INLINE_SCRIPTS.SPECULATION_RULES).toBe(SPECULATION_RULES);
  });
});
