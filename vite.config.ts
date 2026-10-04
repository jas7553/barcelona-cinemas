/// <reference types="vitest" />
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { configDefaults } from "vitest/config";
// @ts-expect-error — plain ESM helper, no types
import { renderDocument } from "./scripts/template.mjs";
// @ts-expect-error — plain ESM helper, no types
import { SITE_TIMEZONE, objectKeyFor } from "./scripts/site-constants.mjs";

const DATA_FILE = path.resolve(__dirname, "static/data/listings.json");

function readListings(): {
  generated_at: string;
  stale: boolean;
  theaters: unknown[];
  movies: { id: string }[];
} {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    // Run `npm run export-data` to render real listings in dev.
    return { generated_at: new Date().toISOString(), stale: false, theaters: [], movies: [] };
  }
}

/**
 * Dev-server MPA middleware. Resolves each request to its bucket key the way
 * CloudFront does, then renders that page on the fly through the same
 * entry-server used for SSG, so the dev page mirrors the built one. The client
 * entry is loaded from source (HMR via transformIndexHtml).
 */
function ssgDevServer(): Plugin {
  return {
    name: "ssg-dev-server",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const key: string = objectKeyFor(decodeURIComponent((req.url || "/").split("?")[0]));
        if (!key.endsWith(".html")) return next();
        try {
          const mod = await server.ssrLoadModule("/src/entry-server.tsx");
          const listings = readListings();
          const renderedAt = new Date().toISOString();
          const filmId = key.match(/^film\/([^/]+)\.html$/)?.[1];
          const site = (mod.sitePages(listings, renderedAt) as { path: string; data: { page: string } }[]).find(
            (p) => p.path === key,
          );

          let doc;
          if (site) {
            const page = mod.renderPage(site.data);
            doc = { ...page, data: site.data, entrySrc: "/src/client.tsx", notFound: site.data.page === "not-found" };
          } else if (filmId) {
            const filmListings = mod.filmListings(listings, filmId);
            if (!filmListings) return next();
            const data = { renderedAt, listings: filmListings, filmId };
            doc = { ...mod.renderFilm(data), data, entrySrc: "/src/legacy/entry-film.tsx" };
          } else {
            return next();
          }

          const html = renderDocument({ ...doc, bodyHtml: doc.html });
          const transformed = await server.transformIndexHtml(req.url || "/", html);
          res.statusCode = doc.notFound ? 404 : 200;
          res.setHeader("Content-Type", "text/html");
          res.end(transformed);
        } catch (e) {
          server.ssrFixStacktrace(e as Error);
          next(e);
        }
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [ssgDevServer()],
  // Interim (UI rewrite slice 0): the old React pages run on Preact via compat.
  // Removed once the last old page is replaced.
  resolve: {
    alias: [
      { find: /^react$/, replacement: "preact/compat" },
      { find: /^react\/jsx-runtime$/, replacement: "preact/compat/jsx-runtime" },
      { find: /^react\/jsx-dev-runtime$/, replacement: "preact/compat/jsx-dev-runtime" },
      { find: /^react-dom$/, replacement: "preact/compat" },
      { find: /^react-dom\/client$/, replacement: "preact/compat/client" },
      { find: /^react-dom\/server$/, replacement: "preact/compat/server" },
      { find: /^react-dom\/test-utils$/, replacement: "preact/test-utils" },
    ],
  },
  // For the production SSR build, bundle everything (incl. React) so the Node SSG
  // Lambda is self-contained. In dev, leave deps external — Vite's ESM module
  // runner can't execute react-dom/server's CommonJS `require` if it's inlined.
  ssr: {
    noExternal: command === "build" ? true : [],
  },
  build: {
    outDir: "static",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        client: path.resolve(__dirname, "src/client.tsx"),
        "entry-film": path.resolve(__dirname, "src/legacy/entry-film.tsx"),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Pin the suite to the site's timezone. Previously unpinned: CI is UTC, so
    // every date assertion was silently being validated in the wrong zone and a
    // real Madrid-vs-UTC bucketing bug could pass. Derived, not literal.
    env: { TZ: SITE_TIMEZONE },
    setupFiles: ["./src/test-setup.ts"],
    exclude: [...configDefaults.exclude, ".aws-sam/**", "e2e/**", ".claude/**"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test-setup.ts"],
      reporter: ["text", "html"],
    },
  },
}));
