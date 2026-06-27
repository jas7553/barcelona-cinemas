import { describe, it, expect } from "vitest";
import { assets, renderAll } from "./render-core.mjs";

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

describe("renderAll() sitemap", () => {
  const manifest = {
    "src/entry-list.tsx": { file: "assets/list.js", isEntry: true },
    "src/entry-film.tsx": { file: "assets/film.js", isEntry: true },
    "src/entry-privacy.tsx": { file: "assets/privacy.js", isEntry: true },
  };
  const server = {
    renderList: () => ({ html: "<main></main>", title: "T", headExtra: "" }),
    renderFilm: () => ({ html: "<main></main>", title: "F", headExtra: "" }),
    renderPrivacy: () => ({ html: "<main></main>", title: "P", headExtra: "" }),
    filmListings: (full, id) => {
      const movie = full.movies.find((m) => m.id === id);
      return movie ? { ...full, movies: [movie] } : null;
    },
  };
  function listings() {
    return {
      generated_at: "2026-06-27T20:39:37+00:00",
      stale: false,
      theaters: [],
      movies: [
        { id: "1", title: "Showing", showtimes: [{ theater_id: "x", date: "2026-06-28", time: "20:00", language: "vo" }] },
        { id: "2", title: "Ended run", showtimes: [] },
      ],
    };
  }
  async function run(siteUrl) {
    const writes = new Map();
    await renderAll({ listings: listings(), manifest, server, siteUrl, write: (p, c) => writes.set(p, c) });
    return writes;
  }

  it("lists the index + only films with showtimes, using absolute URLs", async () => {
    const sm = (await run("https://x.test")).get("sitemap.xml");
    expect(sm).toContain("<loc>https://x.test/</loc>");
    expect(sm).toContain("<loc>https://x.test/film/1</loc>");
    expect(sm).not.toContain("/film/2"); // zero-showtime film is noindex, not in the sitemap
    expect(sm).toContain("<lastmod>2026-06-27</lastmod>");
  });

  it("includes /privacy in the sitemap with low priority and yearly changefreq", async () => {
    const sm = (await run("https://x.test")).get("sitemap.xml");
    expect(sm).toContain("<loc>https://x.test/privacy</loc>");
    expect(sm).toContain("<priority>0.3</priority>");
    expect(sm).toContain("<changefreq>yearly</changefreq>");
  });

  it("renders privacy.html", async () => {
    const writes = await run("https://x.test");
    expect(writes.has("privacy.html")).toBe(true);
  });

  it("omits the sitemap for a local build with no SITE_URL", async () => {
    expect((await run("")).has("sitemap.xml")).toBe(false);
  });
});
