// Standing WCAG 2.1 AA gate for the film detail page: tap-target size (2.5.5),
// text contrast (1.4.3), and no horizontal overflow / clipped text at 200% zoom
// (1.4.4). These caught the regressions in issue #52 and stay as a guard.
//
//   npm run e2e

import { test, expect, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "393x852", width: 393, height: 852 },
  { name: "375x667", width: 375, height: 667 },
];

async function gotoFirstFilm(page: Page): Promise<void> {
  await page.goto("/");
  const href = await page.locator(".film-card").first().getAttribute("href");
  expect(href, "no film card to open").toMatch(/^\/film\//);
  await page.goto(href!);
  await expect(page.locator(".detail-film-title")).toBeVisible();
}

// Every rendered <a>/<button> must present a >= 44x44 CSS px box. Returns the
// offenders so a failure names them.
async function undersizedControls(page: Page) {
  return page.evaluate(() => {
    const out: { cls: string; w: number; h: number }[] = [];
    for (const el of document.querySelectorAll("a, button")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // not rendered (e.g. closed dialog)
      // Round first: sub-pixel layout reports a 44px min-height box as 43.99.
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w < 44 || h < 44) out.push({ cls: String(el.className), w, h });
    }
    return out;
  });
}

for (const vp of VIEWPORTS) {
  test(`film page: every control is a 44px tap target @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await gotoFirstFilm(page);

    expect(
      await undersizedControls(page),
      "controls under 44x44 (collapsed showtimes)",
    ).toEqual([]);

    // Expand a showtime so the action rows (Book / Add to calendar) are covered
    // too. Bookable rows use the chevron; non-bookable rows toggle from the body.
    const more = page.locator(".showtime__more").first();
    if (await more.count()) {
      await more.click();
    } else {
      const bodyBtn = page.locator("button.showtime__main").first();
      if (await bodyBtn.count()) await bodyBtn.click();
    }
    if (await page.locator(".showtime__action").count()) {
      expect(
        await undersizedControls(page),
        "controls under 44x44 (expanded showtime)",
      ).toEqual([]);
    }
  });
}

// Composited contrast of one selector against its nearest opaque ancestor bg.
async function contrast(page: Page, sel: string): Promise<number | null> {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(",").map((x) => parseFloat(x.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fg = parse(getComputedStyle(el).color);
    if (!fg) return null;
    let node: Element | null = el;
    let bg = null;
    while (node) {
      const b = parse(getComputedStyle(node).backgroundColor);
      if (b && b.a === 1) {
        bg = b;
        break;
      }
      node = node.parentElement;
    }
    if (!bg) bg = { r: 255, g: 255, b: 255, a: 1 };
    const l1 = lum(fg);
    const l2 = lum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }, sel);
}

for (const theme of ["light", "dark"] as const) {
  test(`film page: text meets 4.5:1 in ${theme} theme`, async ({ page }) => {
    await page.addInitScript((t) => {
      localStorage.setItem("btw-dark", String(t === "dark"));
    }, theme);
    await gotoFirstFilm(page);

    // WCAG cares about steady-state colors. Freeze transitions/animations so the
    // probe can't sample a chip mid-transition: the clock swap (renderedAt → live)
    // re-flows the day chips in a post-mount effect, and their .12s background
    // transition passes through an alpha < 1 frame, which the walk-up would read
    // as the light page bg — a false failure.
    await page.addStyleTag({
      content: "*,*::before,*::after{transition:none!important;animation:none!important}",
    });

    // Always present on the film page.
    for (const sel of [".day-chip--active", ".sheet-cinema-meta"]) {
      const c = await contrast(page, sel);
      expect(c, `${sel} not found`).not.toBeNull();
      expect(c!, `${sel} contrast`).toBeGreaterThanOrEqual(4.5);
    }
    // Data-dependent (a film may lack credits or skip a day); assert when shown.
    for (const sel of [".credits-label", ".day-chip--faded"]) {
      const c = await contrast(page, sel);
      if (c !== null) expect(c, `${sel} contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test("film page: no horizontal overflow or clipped text at 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await gotoFirstFilm(page);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });

  const { scrollW, clientW, offenders } = await page.evaluate(() => {
    const root = document.documentElement;
    const cw = root.clientWidth;
    const off: { cls: string; right: number }[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > cw + 1) off.push({ cls: String(el.className), right: Math.round(r.right) });
    }
    return { scrollW: root.scrollWidth, clientW: cw, offenders: off.slice(0, 15) };
  });
  expect(scrollW, `overflow past ${clientW}: ${JSON.stringify(offenders)}`).toBeLessThanOrEqual(
    clientW + 1,
  );

  const titleClipped = await page.evaluate(() => {
    const t = document.querySelector(".detail-film-title");
    return t ? t.scrollWidth > t.clientWidth + 1 : false;
  });
  expect(titleClipped, ".detail-film-title is clipped").toBe(false);
});
