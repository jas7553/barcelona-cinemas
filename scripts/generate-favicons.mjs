// Rasterize the favicon SVG sources into the PNGs the site links. Chromium
// (via Playwright, already a dev dependency) renders each size straight from
// the vector, so small sizes stay crisp and transparent corners stay transparent.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url);
const SMALL = 'public/favicon.svg'; // tabs, bookmarks: the single block
const LARGE = 'scripts/apple-touch-icon.svg'; // home screens: the block among neighbours

const OUTPUTS = [
  [SMALL, 'public/favicon-16x16.png', 16],
  [SMALL, 'public/favicon-32x32.png', 32],
  [SMALL, 'public/favicon.png', 256],
  [LARGE, 'public/apple-touch-icon.png', 180],
  [LARGE, 'public/icon-512.png', 512],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [src, out, size] of OUTPUTS) {
    const svg = await readFile(new URL(src, ROOT), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await writeFile(new URL(out, ROOT), await page.screenshot({ omitBackground: true }));
    console.log(`${out} (${size}px) from ${src}`);
  }
} finally {
  await browser.close();
}
