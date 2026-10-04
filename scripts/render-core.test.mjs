import { describe, it, expect } from "vitest";
import { assets, renderAll } from "./render-core.mjs";

describe("assets()", () => {
  it("keeps CSS Vite hoisted into a shared chunk, and preloads the chunk", () => {
    const manifest = {
      "src/client.tsx": { file: "assets/client-x.js", isEntry: true, imports: ["_runtime-y.js"] },
      "_runtime-y.js": { file: "assets/runtime-y.js", css: ["assets/style-z.css"] },
    };
    const { css, preload } = assets(manifest, "src/client.tsx");
    expect(css).toEqual(["/assets/style-z.css"]);
    expect(preload).toEqual(["/assets/runtime-y.js"]);
  });

  it("throws a build-hint error for a missing entry", () => {
    expect(() => assets({}, "src/client.tsx")).toThrow(/manifest missing entry/);
  });
});

describe("renderAll() sitemap", () => {
  const manifest = { "src/client.tsx": { file: "assets/client.js", isEntry: true } };
  const server = {
    sitePages: (_listings, renderedAt) => [
      { path: "index.html", data: { page: "week", renderedAt } },
      { path: "day/2026-06-28.html", data: { page: "day", renderedAt } },
      { path: "film/1.html", data: { page: "film", renderedAt } },
      { path: "film/1/2026-06-28.html", data: { page: "film", renderedAt } },
      { path: "film/2.html", data: { page: "film", renderedAt } },
      { path: "privacy.html", data: { page: "privacy", renderedAt } },
      { path: "404.html", data: { page: "not-found", renderedAt } },
    ],
    renderPage: (data) => ({ html: `<main>${data.page}</main>`, title: data.page, headExtra: "" }),
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
    expect(sm).toContain("<loc>https://x.test/film/1/</loc>");
    expect(sm).not.toContain("/film/2"); // zero-showtime film is noindex, not in the sitemap
    expect(sm).toContain("<lastmod>2026-06-27</lastmod>");
  });

  it("includes /privacy/ in the sitemap with low priority and yearly changefreq", async () => {
    const sm = (await run("https://x.test")).get("sitemap.xml");
    expect(sm).toContain("<loc>https://x.test/privacy/</loc>");
    expect(sm).toContain("<priority>0.3</priority>");
    expect(sm).toContain("<changefreq>yearly</changefreq>");
  });

  it("renders every page sitePages lists on the shared client entry", async () => {
    const writes = await run("https://x.test");
    expect(writes.get("privacy.html")).toContain('<script type="module" src="/assets/client.js">');
    expect(writes.get("privacy.html")).toContain("<main>privacy</main>");
  });

  it("writes the 404 page with the current bundle and the expired-page redirect", async () => {
    const notFound = (await run("https://x.test")).get("404.html");
    expect(notFound).toContain('src="/assets/client.js"');
    expect(notFound).toContain("location.replace");
    expect((await run("https://x.test")).get("privacy.html")).not.toContain("location.replace");
  });

  it("republishes the listings whole, ended films included", async () => {
    const writes = new Map();
    const withEnded = { ...listings(), ended_movies: [{ id: "9", title: "Over", showtimes: [], last_showing: "2026-06-01" }] };
    await renderAll({ listings: withEnded, manifest, server, siteUrl: "", write: (p, c) => writes.set(p, c) });
    expect(JSON.parse(writes.get("data/listings.json")).ended_movies).toHaveLength(1);
  });

  it("omits the sitemap for a local build with no SITE_URL", async () => {
    expect((await run("")).has("sitemap.xml")).toBe(false);
  });
});

// Film pages for movies that drop out of the listings used to live
// forever: the page 200s while its hashed /assets/* bundle is deleted by the
// next deploy, so it never hydrates and serves frozen showtimes still labelled
// "Today"; the sibling JSON just accumulates in the bucket.
describe("renderAll() prune", () => {
  const manifest = { "src/client.tsx": { file: "assets/client.js", isEntry: true } };
  const server = {
    sitePages: (_listings, renderedAt) => [
      { path: "index.html", data: { page: "week", renderedAt } },
      { path: "day/2026-06-28.html", data: { page: "day", renderedAt } },
      { path: "film/1.html", data: { page: "film", renderedAt } },
      { path: "film/1/2026-06-28.html", data: { page: "film", renderedAt } },
      { path: "film/2.html", data: { page: "film", renderedAt } },
      { path: "cinema/x.html", data: { page: "cinema", renderedAt } },
      { path: "cinema/x/2026-06-28.html", data: { page: "cinema", renderedAt } },
      { path: "cinemas.html", data: { page: "cinemas", renderedAt } },
      { path: "privacy.html", data: { page: "privacy", renderedAt } },
      { path: "404.html", data: { page: "not-found", renderedAt } },
    ],
    renderPage: (data) => ({ html: `<main>${data.page}</main>`, title: data.page, headExtra: "" }),
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

  it("hands prune exactly the film and day paths this render wrote", async () => {
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
    // Ended films still get a (noindex) page, so their paths are kept too.
    expect([...keep].sort()).toEqual([
      "cinema/x.html",
      "cinema/x/2026-06-28.html",
      "day/2026-06-28.html",
      "film/1.html",
      "film/1/2026-06-28.html",
      "film/2.html",
    ]);
  });

  it("keeps the shared documents out of the set — they live outside every prefix", async () => {
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
    for (const p of ["index.html", "privacy.html", "cinemas.html", "sitemap.xml", "data/listings.json"]) {
      expect(keep.has(p)).toBe(false);
    }
  });

  it("keeps every film and day path it wrote — nothing live is ever swept", async () => {
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
      (p) => /^(film|day|cinema)\//.test(p),
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
    expect(writes.has("film/1/2026-06-28.html")).toBe(true);
    expect(writes.has("index.html")).toBe(true);
  });
});
