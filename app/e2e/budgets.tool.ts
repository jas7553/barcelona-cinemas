// Gzip size per registered page: the HTML, and the sum of the same-origin CSS
// and JS it loads (docs/plan.md §7.2). Prints a table; fails if any page is
// over budget.
import { gzipSync } from "node:zlib";
import type { Response } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { PAGES } from "./pages.ts";

const KB = 1024;
const BUDGET = { html: 60 * KB, css: 15 * KB, js: 20 * KB } as const;
type Kind = keyof typeof BUDGET;

const KINDS: Readonly<Record<string, Kind>> = {
  document: "html",
  stylesheet: "css",
  script: "js",
};

test("pages stay within their gzip budgets", async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? "").origin;
  const rows: { name: string; sizes: Record<Kind, number> }[] = [];

  for (const entry of PAGES) {
    const sizes: Record<Kind, number> = { html: 0, css: 0, js: 0 };
    const pending: Promise<void>[] = [];
    const onResponse = (response: Response) => {
      const kind = KINDS[response.request().resourceType()];
      if (!kind || new URL(response.url()).origin !== origin) return;
      pending.push(
        response.body().then((body) => {
          sizes[kind] += gzipSync(body).length;
        }),
      );
    };
    page.on("response", onResponse);
    await page.goto(entry.path);
    await page.waitForLoadState("networkidle");
    page.off("response", onResponse);
    await Promise.all(pending);
    rows.push({ name: `${entry.page}/${entry.state}`, sizes });
  }

  const kb = (bytes: number) => `${(bytes / KB).toFixed(1)} KB`;
  const kinds = Object.keys(BUDGET) as Kind[];
  const width = Math.max(...rows.map((r) => r.name.length), "budget".length);
  const line = (name: string, cells: string[]) =>
    [name.padEnd(width), ...cells.map((c) => c.padStart(10))].join("  ");
  const over = rows.flatMap((r) =>
    kinds.filter((k) => r.sizes[k] > BUDGET[k]).map((k) => `${r.name} ${k}`),
  );
  const table = [
    line(
      "gzip",
      kinds.map((k) => k.toUpperCase()),
    ),
    ...rows.map((r) =>
      line(
        r.name,
        kinds.map((k) => `${r.sizes[k] > BUDGET[k] ? "✗ " : ""}${kb(r.sizes[k])}`),
      ),
    ),
    line(
      "budget",
      kinds.map((k) => kb(BUDGET[k])),
    ),
  ].join("\n");

  console.log(table);
  expect(over, `over budget:\n${table}`).toEqual([]);
});
