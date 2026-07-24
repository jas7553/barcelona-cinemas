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

// Per-film output for movies that drops out of the listings used to live
// forever: the page 200s while its hashed /assets/* bundle is deleted by the
// next deploy, so it never hydrates and serves frozen showtimes still labelled
// "Today"; the sibling JSON just accumulates in the bucket.
describe("renderAll() prune", () => {
  const manifest = {
    "src/entry-list.tsx": { file: "assets/list.js", isEntry: true },
    "src/entry-film.tsx": { file: "assets/film.js", isEntry: true },
    "src/entry-privacy.tsx": { file: "assets/privacy.js", isEntry: true },
  };
  const server = {
    renderList: () => ({ html: "<main></main>", title: "T", headExtra: "" }),
    renderFilm: () => ({ html: "<main></main>", title: "F", headExtra: "" }),
    renderPrivacy: () => ({ html: "<main></main>", title: "P", headExtra: "" }),
    filmListings: (full, id) => ({ ...full, movies: full.movies.filter((m) => m.id === id) }),
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

  /** Every path renderAll actually wrote, so keep-set claims can be checked against reality. */
  async function writtenPaths() {
    const paths = new Set();
    await renderAll({
      listings: listings(),
      manifest,
      server,
      siteUrl: "https://x.test",
      write: (p) => paths.add(p),
    });
    return paths;
  }

  it("hands prune exactly the per-film paths this render wrote", async () => {
    let keep;
    await renderAll({
      listings: listings(),
      manifest,
      server,
      siteUrl: "https://x.test",
      write: () => {},
      prune: (k) => {
        keep = k;
      },
    });
    // Both prefixes, and zero-showtime films still get a (noindex) page + JSON,
    // so all four paths must be kept.
    expect([...keep].sort()).toEqual([
      "data/film/1.json",
      "data/film/2.json",
      "film/1.html",
      "film/2.html",
    ]);
  });

  it("keeps the shared documents out of the set — they live outside both prefixes", async () => {
    let keep;
    await renderAll({
      listings: listings(),
      manifest,
      server,
      siteUrl: "https://x.test",
      write: () => {},
      prune: (k) => {
        keep = k;
      },
    });
    // data/listings.json sits under data/ but NOT under data/film/, so the
    // sweep can never reach it — but a stray keep-set entry would be a smell.
    for (const p of ["index.html", "privacy.html", "sitemap.xml", "data/listings.json"]) {
      expect(keep.has(p)).toBe(false);
    }
  });

  it("keeps every per-film path it wrote — nothing live is ever swept", async () => {
    let keep;
    await renderAll({
      listings: listings(),
      manifest,
      server,
      siteUrl: "https://x.test",
      write: () => {},
      prune: (k) => {
        keep = k;
      },
    });
    // The real invariant: any written path under a swept prefix must be in the
    // keep set, or this render would delete output it just produced.
    const swept = [...(await writtenPaths())].filter(
      (p) => p.startsWith("film/") || p.startsWith("data/film/"),
    );
    expect(swept.length).toBeGreaterThan(0);
    for (const p of swept) expect(keep.has(p)).toBe(true);
  });

  it("is called exactly once, after every write has landed", async () => {
    const order = [];
    await renderAll({
      listings: listings(),
      manifest,
      server,
      siteUrl: "https://x.test",
      write: (p) => {
        order.push(`write:${p}`);
      },
      prune: () => {
        order.push("prune");
      },
    });
    expect(order.filter((o) => o === "prune")).toHaveLength(1);
    expect(order[order.length - 1]).toBe("prune");
  });

  it("awaits an async prune before resolving", async () => {
    let settled = false;
    await renderAll({
      listings: listings(),
      manifest,
      server,
      siteUrl: "",
      write: () => {},
      prune: async () => {
        await Promise.resolve();
        settled = true;
      },
    });
    expect(settled).toBe(true);
  });

  it("never prunes after a partial render — a failed write must delete nothing", async () => {
    let pruned = false;
    await expect(
      renderAll({
        listings: listings(),
        manifest,
        server,
        siteUrl: "https://x.test",
        write: (p) => {
          if (p === "film/2.html") throw new Error("S3 put failed");
        },
        prune: () => {
          pruned = true;
        },
      }),
    ).rejects.toThrow("S3 put failed");
    expect(pruned).toBe(false);
  });

  it("renders unchanged when no prune sink is supplied", async () => {
    const writes = new Map();
    await renderAll({
      listings: listings(),
      manifest,
      server,
      siteUrl: "https://x.test",
      write: (p, c) => writes.set(p, c),
    });
    expect(writes.has("film/1.html")).toBe(true);
    expect(writes.has("film/2.html")).toBe(true);
    expect(writes.has("data/film/1.json")).toBe(true);
    expect(writes.has("index.html")).toBe(true);
  });
});
