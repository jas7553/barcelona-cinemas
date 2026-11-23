// Each page check, run on a stub page that breaks its rule, must fail. The bad
// pages live in stub/bad/, outside the registry. The flow checks prove the same
// in their own specs: cls.spec.ts, scroll.spec.ts and bfcache.spec.ts.
import type { Page } from "@playwright/test";
import { checkAxe } from "./checks/axe.ts";
import { watchConsole } from "./checks/console.ts";
import { watchCsp } from "./checks/csp.ts";
import { checkExternalLinks } from "./checks/external-links.ts";
import { checkFocus } from "./checks/focus.ts";
import { checkHtml } from "./checks/html.ts";
import { checkNoJs } from "./checks/no-js.ts";
import { watchNetwork } from "./checks/network.ts";
import { checkNoOverflow } from "./checks/overflow.ts";
import { checkNoSeparators } from "./checks/separators.ts";
import { checkTapTargets } from "./checks/tap-targets.ts";
import { checkTimes } from "./checks/times.ts";
import { expect, test } from "./fixtures.ts";
import { PAGES, type PageEntry } from "./pages.ts";
import { VIEWPORTS, contextFor } from "./viewports.ts";

const phone = VIEWPORTS[0];
if (!phone) throw new Error("no viewports");
test.use(contextFor(phone));

test("no bad page is in the registry", () => {
  expect(PAGES.filter((p) => p.path.startsWith("/bad/"))).toEqual([]);
});

const pageChecks: [string, (page: Page) => Promise<void>, ...RegExp[]][] = [
  ["overflow", checkNoOverflow, /horizontal overflow/],
  ["overflow-clipped", checkNoOverflow, /too-wide.*spans/],
  [
    "sideways-scroll",
    checkNoOverflow,
    /class="small-scroller".*scrolls sideways/,
    /class="too-wide".*spans/,
  ],
  ["small-target", checkTapTargets, /targets under 44×44/],
  ["no-arrow", checkExternalLinks, /no ↗/],
  ["stray-place", checkExternalLinks, /data-place outside a showing/],
  ["icon-not-last", checkExternalLinks, /data-external-icon isn't the link's last child/],
  ["unnamed-icon", checkExternalLinks, /data-external-icon without role="img" and a name/],
  ["separator", checkNoSeparators, /Drama · 2h/],
  ["twelve-hour", checkTimes, /not HH:MM/],
  ["clock-text", checkTimes, /"9:30"/, /data-film-text around a showing/],
  ["no-focus-ring", checkFocus, /no visible outline on focus: <a class="button no-ring"/],
  ["tab-order", checkFocus, /a positive tabindex/, /Tab went back up the page/],
  ["axe", checkAxe, /color-contrast/],
];

async function failureOf(check: Promise<void>): Promise<string> {
  return check.then(
    () => "passed",
    (error: unknown) => String(error),
  );
}

for (const [bad, check, ...failures] of pageChecks) {
  test(`${check.name} fails on bad/${bad}`, async ({ page }) => {
    await page.goto(`/bad/${bad}`);
    const failure = await failureOf(check(page));
    for (const expected of failures) expect(failure).toMatch(expected);
  });
}

test("the separator check passes the Catalan punt volat", async ({ page }) => {
  await page.goto("/bad/separator");
  expect(await failureOf(checkNoSeparators(page))).not.toMatch(/l·l/);
  await page.goto("/");
  await expect(page.getByText("Col·lecció d’il·lusions")).toBeVisible();
  await checkNoSeparators(page);
});

test("the times check skips clock-like film text", async ({ page }) => {
  await page.goto("/bad/clock-text");
  expect(await failureOf(checkTimes(page))).not.toMatch(/3:10/);
  await page.goto("/");
  await expect(page.locator("[data-film-text]", { hasText: "3:10 to Yuma" })).toBeVisible();
  await checkTimes(page);
});

test("checkHtml fails on bad/invalid-html", async ({ request }) => {
  const response = await request.get("/bad/invalid-html");
  await expect(checkHtml(await response.text())).rejects.toThrow(/invalid HTML/);
});

test("the network check fails on bad/third-party", async ({ page, baseURL }) => {
  const network = await watchNetwork(page, new URL(baseURL ?? "").origin);
  await page.goto("/bad/third-party");
  await page.waitForLoadState("networkidle");
  expect(() => {
    network.check();
  }).toThrow(/not allowed: https:\/\/example\.com\/pixel\.png/);
});

test("the CSP check fails on bad/inline-script", async ({ page }) => {
  const csp = await watchCsp(page);
  await page.goto("/bad/inline-script");
  await page.waitForLoadState("networkidle");
  expect(() => {
    csp.check();
  }).toThrow(/script-src-elem blocked inline/);
});

test("the CSP check fails on a page served without a policy", async ({ page }) => {
  const csp = await watchCsp(page);
  await page.route("**/bad/separator", async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["content-security-policy"];
    await route.fulfill({ response, headers });
  });
  await page.goto("/bad/separator");
  expect(() => {
    csp.check();
  }).toThrow(/no Content-Security-Policy header/);
});

test("the console check fails on bad/console-error", async ({ page }) => {
  const consoleErrors = watchConsole(page);
  await page.goto("/bad/console-error");
  await page.waitForLoadState("networkidle");
  expect(() => {
    consoleErrors.check();
  }).toThrow(/an error in the console/);
});

test.describe("with JavaScript on", () => {
  test("the no-JS check fails, since the noscript form never shows", async ({ page }) => {
    const entry = PAGES.find((p) => p.noJs.filterForm);
    if (!entry) throw new Error("no registered page has a filter form");
    await expect(checkNoJs(page, entry)).rejects.toThrow(/<noscript> form/);
  });
});

test.describe("with JavaScript off", () => {
  test.use({ javaScriptEnabled: false });

  const listings = (bad: string): PageEntry => ({
    page: "bad",
    state: bad,
    path: `/bad/${bad}`,
    noJs: { listings: true, filterForm: false },
  });

  test("the no-JS check fails on bad/showing-without-time", async ({ page }) => {
    await expect(checkNoJs(page, listings("showing-without-time"))).rejects.toThrow(
      /a showing without a time link/,
    );
  });

  test("the no-JS check fails on bad/dead-link", async ({ page }) => {
    await expect(checkNoJs(page, listings("dead-link"))).rejects.toThrow(
      /link to \S+\/film\/no-such-film answered 404/,
    );
  });
});
