import { describe, it, expect } from "vitest";
import { hexToRgb, rgbToHex, mixRgb, compositeOverlay, mixHex, sampleTopEdgeColor } from "./backdropColor";

describe("hexToRgb / rgbToHex", () => {
  it("round-trips", () => {
    expect(hexToRgb("#0f0e0c")).toEqual({ r: 15, g: 14, b: 12 });
    expect(rgbToHex({ r: 15, g: 14, b: 12 })).toBe("#0f0e0c");
  });

  it("clamps and rounds out-of-range channels", () => {
    expect(rgbToHex({ r: -5, g: 300, b: 127.6 })).toBe("#00ff80");
  });
});

describe("mixRgb", () => {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };

  it("returns a at t=0 and b at t=1", () => {
    expect(mixRgb(black, white, 0)).toEqual(black);
    expect(mixRgb(black, white, 1)).toEqual(white);
  });

  it("interpolates at t=0.5", () => {
    expect(mixRgb(black, white, 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
  });

  it("clamps t outside [0,1]", () => {
    expect(mixRgb(black, white, -1)).toEqual(black);
    expect(mixRgb(black, white, 2)).toEqual(white);
  });
});

describe("compositeOverlay", () => {
  it("folds a translucent overlay onto a base colour", () => {
    const base = { r: 200, g: 200, b: 200 };
    const overlay = { r: 0, g: 0, b: 0 };
    // 10% black over light grey darkens it by 10%.
    expect(compositeOverlay(base, overlay, 0.1)).toEqual({ r: 180, g: 180, b: 180 });
  });

  it("is a no-op at alpha 0", () => {
    const base = { r: 12, g: 34, b: 56 };
    expect(compositeOverlay(base, { r: 0, g: 0, b: 0 }, 0)).toEqual(base);
  });
});

describe("mixHex", () => {
  it("mixes page background and sampled colour by opacity", () => {
    expect(mixHex("#faf6ef", "#0f0e0c", 0)).toBe("#faf6ef");
    expect(mixHex("#faf6ef", "#0f0e0c", 1)).toBe("#0f0e0c");
  });
});

describe("sampleTopEdgeColor", () => {
  it("returns null when canvas 2d context is unavailable (jsdom has no canvas backend)", () => {
    const img = document.createElement("img");
    expect(sampleTopEdgeColor(img)).toBeNull();
  });
});
