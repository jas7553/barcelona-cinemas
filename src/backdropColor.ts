// Tints the iOS Safari status-bar strip (via <meta name="theme-color">) to
// match the film page's backdrop image, instead of leaving it the flat page
// background. Pure colour math lives here; DOM/canvas wiring lives in FilmPage.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#rrggbb` → `{r,g,b}`. Assumes a well-formed 6-digit hex string. */
export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** `{r,g,b}` → `#rrggbb`, clamping/rounding each channel. */
export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear-interpolate two colours: `t=0` → `a`, `t=1` → `b`. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const w = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * w,
    g: a.g + (b.g - a.g) * w,
    b: a.b + (b.b - a.b) * w,
  };
}

/**
 * Flatten a translucent overlay colour onto a base colour (alpha compositing
 * over an opaque background) — used to fold the backdrop gradient's top stop
 * into a sampled pixel so the result matches what's actually on screen.
 */
export function compositeOverlay(
  base: Rgb,
  overlay: Rgb,
  overlayAlpha: number,
): Rgb {
  return mixRgb(base, overlay, overlayAlpha);
}

/** `mixRgb` for hex colours in, hex out — the shape the theme-color meta wants. */
export function mixHex(hexA: string, hexB: string, t: number): string {
  return rgbToHex(mixRgb(hexToRgb(hexA), hexToRgb(hexB), t));
}

/**
 * The URL to load for colour sampling: the w300 variant of a TMDb backdrop.
 * Must differ from the URL the visible <img> renders (see FilmPage) and only
 * needs enough pixels for an average. Non-TMDb URLs pass through unchanged.
 */
export function backdropSampleUrl(url: string): string {
  return url.replace(/(\/\/image\.tmdb\.org\/t\/p\/)w\d+\//, "$1w300/");
}

/**
 * Average the top ~10% of an image into a tiny offscreen canvas — cheap enough
 * to run once per load. Returns null on any failure (canvas unsupported, the
 * image taints the canvas, jsdom without a canvas backend): callers should
 * leave the existing theme-color behaviour untouched in that case.
 */
export function sampleTopEdgeColor(img: HTMLImageElement): Rgb | null {
  try {
    const w = 32;
    const h = 4;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const srcH = Math.max(1, Math.round(img.naturalHeight * 0.1));
    ctx.drawImage(img, 0, 0, img.naturalWidth, srcH, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let r = 0;
    let g = 0;
    let b = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return { r: r / n, g: g / n, b: b / n };
  } catch {
    return null;
  }
}
