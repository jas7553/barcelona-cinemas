/// <reference types="vitest" />
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { configDefaults } from "vitest/config";
// @ts-expect-error — plain ESM helper, no types
import { renderDocument, render404Document } from "./scripts/template.mjs";
// @ts-expect-error — plain ESM helper, no types
import { SITE_TIMEZONE } from "./scripts/site-constants.mjs";

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
 * Dev-server MPA middleware. Renders `/` and `/film/<id>` on the fly through the
 * same entry-server used for SSG, so the dev page mirrors the built page. The
 * client entry is loaded from source (HMR via transformIndexHtml).
 */
function ssgDevServer(): Plugin {
  return {
    name: "ssg-dev-server",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "/").split("?")[0];
        const isList = url === "/" || url === "/index.html";
        const filmMatch = url.match(/^\/film\/([^/]+?)(?:\.html)?$/);
        const isPrivacy = url === "/privacy" || url === "/privacy.html";
        // 404.html is generated at build time (scripts/render.mjs), not shipped
        // from public/, so dev has to serve it from the same template.
        if (url === "/404.html") {
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html");
          res.end(render404Document());
          return;
        }
        if (!isList && !filmMatch && !isPrivacy) return next();

        try {
          const mod = await server.ssrLoadModule("/src/entry-server.tsx");
          const listings = readListings();
          const renderedAt = new Date().toISOString();

          let html: string;
          if (isList) {
            const data = { renderedAt, listings };
            const page = mod.renderList(data);
            html = renderDocument({
              title: page.title,
              headExtra: page.headExtra,
              bodyHtml: page.html,
              data,
              entrySrc: "/src/entry-list.tsx",
            });
          } else if (isPrivacy) {
            const page = mod.renderPrivacy();
            html = renderDocument({
              title: page.title,
              headExtra: page.headExtra,
              bodyHtml: page.html,
              data: null,
              entrySrc: "/src/entry-privacy.tsx",
            });
          } else {
            const filmId = decodeURIComponent(filmMatch![1]);
            const filmListings = mod.filmListings(listings, filmId);
            if (!filmListings) return next();
            const data = { renderedAt, listings: filmListings, filmId };
            const page = mod.renderFilm(data);
            html = renderDocument({
              title: page.title,
              headExtra: page.headExtra,
              bodyHtml: page.html,
              data,
              entrySrc: "/src/entry-film.tsx",
            });
          }

          const transformed = await server.transformIndexHtml(req.url || "/", html);
          res.statusCode = 200;
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
  plugins: [react(), ssgDevServer()],
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
        "entry-list": path.resolve(__dirname, "src/entry-list.tsx"),
        "entry-film": path.resolve(__dirname, "src/entry-film.tsx"),
        "entry-privacy": path.resolve(__dirname, "src/entry-privacy.tsx"),
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
    exclude: [...configDefaults.exclude, ".aws-sam/**", "e2e/**"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test-setup.ts"],
      reporter: ["text", "html"],
    },
  },
}));
