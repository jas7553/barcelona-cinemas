import { describe, it, expect } from "vitest";
import { assets } from "./render-core.mjs";

// Regression guard: Vite hoists the global style.css (imported by both entries)
// into a shared chunk — here the useLocationPin chunk, whose JS we deliberately
// skip preloading. The skip must NOT also drop its CSS, or every page renders
// unstyled (the stylesheet vanishes from the document <head>).
const HOISTED_CSS = "assets/style-abc123.css";

function manifestWithHoistedCss() {
  return {
    "src/entry-list.tsx": {
      file: "assets/entry-list-xxx.js",
      isEntry: true,
      imports: ["_useLocationPin-yyy.js"],
      // No own css — the global stylesheet was hoisted onto the import below.
    },
    "_useLocationPin-yyy.js": {
      file: "assets/useLocationPin-yyy.js",
      css: [HOISTED_CSS],
    },
  };
}

describe("assets()", () => {
  it("keeps CSS hoisted into the skipped useLocationPin chunk", () => {
    const { css, preload } = assets(manifestWithHoistedCss(), "src/entry-list.tsx");
    // The stylesheet must survive...
    expect(css).toContain("/" + HOISTED_CSS);
    // ...even though the hook's JS is excluded from module preloads.
    expect(preload.some((p) => p.includes("useLocationPin"))).toBe(false);
  });

  it("never resolves an entry to an empty stylesheet set", () => {
    // Any entry that transitively imports CSS must surface at least one href;
    // an empty result means the page would ship without styles.
    const { css } = assets(manifestWithHoistedCss(), "src/entry-list.tsx");
    expect(css.length).toBeGreaterThan(0);
  });

  it("throws a build-hint error for a missing entry", () => {
    expect(() => assets({}, "src/entry-list.tsx")).toThrow(/manifest missing entry/);
  });
});
