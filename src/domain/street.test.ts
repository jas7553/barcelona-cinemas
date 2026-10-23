import { describe, expect, it } from "vitest";
import { streetMap } from "./street";

const GIRONA = { lat: 41.3955, lng: 2.1655 };

describe("streetMap", () => {
  it("covers the whole map with tiles, and no more", () => {
    const m = streetMap(GIRONA, 358, 180);
    const xs = m.tiles.map((t) => t.x);
    const ys = m.tiles.map((t) => t.y);
    expect(Math.min(...xs)).toBeLessThanOrEqual(0);
    expect(Math.min(...ys)).toBeLessThanOrEqual(0);
    expect(Math.max(...xs) + 256).toBeGreaterThanOrEqual(358);
    expect(Math.max(...ys) + 256).toBeGreaterThanOrEqual(180);
    for (const t of m.tiles) {
      expect(t.x).toBeGreaterThan(-256);
      expect(t.y).toBeGreaterThan(-256);
      expect(t.x).toBeLessThan(358);
      expect(t.y).toBeLessThan(180);
    }
  });

  it("asks for the tile Barcelona is on", () => {
    // Plaça de Catalunya's z16 tile, by the OSM wiki's slippy-map formula.
    const m = streetMap({ lat: 41.387, lng: 2.17 }, 1, 1);
    expect(m.tiles).toHaveLength(1);
    expect(m.tiles[0].href).toMatch(/\/voyager\/16\/33163\/24477@2x\.png$/);
  });

  it("puts the centre in the middle, and a place off the map nowhere", () => {
    const m = streetMap(GIRONA, 358, 180);
    expect(m.at(GIRONA)).toEqual({ x: 179, y: 90 });
    const north = m.at({ lat: GIRONA.lat + 0.0005, lng: GIRONA.lng })!;
    expect(north.y).toBeLessThan(90);
    expect(m.at({ lat: 41.44, lng: 2.2 })).toBeNull();
  });
});
