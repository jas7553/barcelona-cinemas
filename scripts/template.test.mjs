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
  INLINE_SCRIPTS,
  SPECULATION_RULES,
  THEME_SCRIPT,
  cspScriptHashes,
  render404Document,
  renderDocument,
} from "./template.mjs";

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

function samplePage() {
  return renderDocument({
    title: "t",
    headExtra: "",
    bodyHtml: "<main></main>",
    data: { a: 1 },
    entrySrc: "/assets/x.js",
  });
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

  it("covers exactly the inline scripts the rendered document actually contains", () => {
    // Guards the case where someone adds a third inline <script> to the template
    // but not to INLINE_SCRIPTS — the hash set above would still be "complete".
    const page = samplePage();
    const inline = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => ({ tag: m[0], body: m[1] }))
      // Inert data blocks (the hydration payload, ld+json) are not executed, so
      // CSP never evaluates them and they need no allowance.
      .filter(({ tag }) => !/type="application\/(json|ld\+json)"/.test(tag))
      .map(({ body }) => body);

    expect(inline.sort()).toEqual(Object.values(INLINE_SCRIPTS).sort());
  });
});

describe("404 page", () => {
  it("embeds THEME_SCRIPT itself, not a copy of it", () => {
    // public/404.html used to paste the script in as a literal. That paste was
    // outside the CSP hash's field of view and could drift byte-for-byte.
    expect(render404Document()).toContain(`<script>${THEME_SCRIPT}</script>`);
  });

  it("ships the identical theme script as every rendered page", () => {
    const themeTagIn = (html) => html.match(/<script>\(function\(\)[\s\S]*?<\/script>/)?.[0];
    expect(themeTagIn(render404Document())).toBe(themeTagIn(samplePage()));
    expect(themeTagIn(render404Document())).toBeTruthy();
  });

  it("has no inline script beyond the theme script", () => {
    // The 404 page is served for keys that don't exist, so it can't load a
    // bundle — but it also must not grow a second unhashed inline block.
    const inline = [...render404Document().matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(
      (m) => m[1],
    );
    expect(inline).toEqual([THEME_SCRIPT]);
  });
});

describe("cspScriptHashes()", () => {
  it("derives from the body, so editing a script changes its hash", () => {
    // Sanity: the hashes are computed, not constants that happen to look right.
    expect(cspScriptHashes().THEME_SCRIPT).toMatch(/^'sha256-[A-Za-z0-9+/]+={0,2}'$/);
    expect(cspScriptHashes().SPECULATION_RULES).not.toBe(cspScriptHashes().THEME_SCRIPT);
    expect(INLINE_SCRIPTS.SPECULATION_RULES).toBe(SPECULATION_RULES);
  });
});
