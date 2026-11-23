import type { Page } from "@playwright/test";
import { SHOWING } from "../markers.ts";
import type { PageEntry } from "../pages.ts";

/**
 * With JavaScript off (the page must come from a `javaScriptEnabled: false`
 * context), the page works as the registry says:
 * - it loads, and every same-origin link on it loads too;
 * - listings: showings are there, each with an http(s) link around a `<time>`
 *   (the booking link, among the showing's cinema links);
 * - filter form: a `<noscript>` form shows (proof that scripting is off), and
 *   submitting it loads a page whose URL carries the form's fields, so a
 *   filtered view can be shared and reloaded.
 */
export async function checkNoJs(page: Page, entry: PageEntry): Promise<void> {
  const problems: string[] = [];
  const response = await page.goto(entry.path);
  if (!response?.ok()) throw new Error(`no-JS: ${entry.path} answered ${response?.status()}`);

  const links = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .filter((a) => new URL(a.href).origin === location.origin)
      .map((a) => a.href.split("#")[0] ?? a.href),
  );
  for (const url of new Set(links)) {
    const linked = await page.request.get(url);
    if (!linked.ok()) problems.push(`link to ${url} answered ${linked.status()}`);
  }

  if (entry.noJs.listings) {
    const showings = await page.evaluate((marker) => {
      const all = [...document.querySelectorAll(`[${marker}]`)];
      const broken = all
        .filter((s) => {
          const link = s.querySelector<HTMLAnchorElement>("a[href]:has(time)");
          return !link || !/^https?:$/.test(new URL(link.href).protocol);
        })
        .map((s) => s.outerHTML.slice(0, 100));
      return { count: all.length, broken };
    }, SHOWING);
    if (showings.count === 0) problems.push(`no [${SHOWING}] showings`);
    problems.push(...showings.broken.map((s) => `a showing without a time link: ${s}`));
  }

  if (entry.noJs.filterForm) {
    problems.push(...(await submitFilterForm(page)));
  }

  if (problems.length > 0) throw new Error(`no-JS:\n  ${problems.join("\n  ")}`);
}

async function submitFilterForm(page: Page): Promise<string[]> {
  const form = page.locator("noscript form");
  if ((await form.count()) !== 1) return ["expected one <noscript> form"];
  if (!(await form.isVisible())) return ["the <noscript> form isn't visible"];
  const fields = await form.evaluate((f: HTMLFormElement) => {
    for (const select of f.querySelectorAll("select")) {
      select.selectedIndex = select.options.length - 1;
    }
    return [...new FormData(f).keys()];
  });
  const navigation = page.waitForResponse((r) => r.request().isNavigationRequest());
  await form.locator("[type=submit]").click();
  const response = await navigation;
  const params = new URL(response.url()).searchParams;
  const problems: string[] = [];
  if (!response.ok()) problems.push(`submitting the filter form answered ${response.status()}`);
  const missing = fields.filter((name) => !params.has(name));
  if (fields.length === 0 || missing.length > 0) {
    problems.push(`the filter form's fields aren't in the URL: ${response.url()}`);
  }
  return problems;
}
