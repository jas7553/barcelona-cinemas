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
  theaters: unknown[];
  movies: { id: string }[];
} {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    // Run `npm run export-data` to render real listings in dev.
    return { generated_at: new Date().toISOString(), theaters: [], movies: [] };
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
          const site = (mod.sitePages(listings, renderedAt) as { path: string; data: { page: string } }[]).find(
            (p) => p.path === key,
          );

          if (!site) return next();
          const page = mod.renderPage(site.data);
          const doc = { ...page, data: site.data, entrySrc: "/src/client.tsx", notFound: site.data.page === "not-found" };

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
  // For the production SSR build, bundle everything (Preact included) so the
  // Node SSG Lambda is self-contained. In dev, leave deps external.
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
