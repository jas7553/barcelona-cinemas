import type { BrowserContextOptions } from "@playwright/test";

export interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Touch, the mobile viewport meta and the device's pixel ratio. */
  readonly device: Pick<BrowserContextOptions, "isMobile" | "hasTouch" | "deviceScaleFactor">;
}

/** The plan's five widths (docs/plan.md §4): every brief rule and every shot runs at each. */
export const VIEWPORTS: readonly Viewport[] = [
  { name: "phone", width: 390, height: 844, device: touch(3) },
  { name: "ipad-portrait", width: 820, height: 1180, device: touch(2) },
  { name: "ipad-landscape", width: 1180, height: 820, device: touch(2) },
  { name: "desktop", width: 1440, height: 900, device: desktop(2) },
  { name: "large-monitor", width: 2560, height: 1440, device: desktop(1) },
];

/** axe runs at phone and desktop only (docs/plan.md §7.2), and so do the no-jump flows. */
export const KEY_VIEWPORTS = VIEWPORTS.filter((v) => v.width === 390 || v.width === 1440);

function touch(deviceScaleFactor: number): Viewport["device"] {
  return { isMobile: true, hasTouch: true, deviceScaleFactor };
}

function desktop(deviceScaleFactor: number): Viewport["device"] {
  return { isMobile: false, hasTouch: false, deviceScaleFactor };
}

/** Context options for `test.use`. */
export function contextFor(v: Viewport): BrowserContextOptions {
  return { viewport: { width: v.width, height: v.height }, ...v.device };
}
