import { describe, expect, it } from "vitest";
import type { Theater } from "../types";
import { buildMap, type MapOptions } from "./map";

const theater = (id: string, lat: number | null, lng: number | null): Theater => ({
  id,
  name: id,
  address: "",
  neighborhood: "",
  website_url: "",
  maps_url: "",
  lat,
  lng,
});
const THEATERS = [
  theater("verdi", 41.404, 2.1569),
  theater("girona", 41.3955, 2.1655),
  theater("maquinista", 41.4398, 2.1983),
  theater("nowhere", null, null),
];
const HOME = { lat: 41.4021, lng: 2.1558 };

const options = (o: Partial<MapOptions> = {}): MapOptions => ({
  theaters: THEATERS,
  frame: ["verdi", "girona"],
  width: 358,
  height: 230,
  minSpan: 2.5,
  home: HOME,
  favourites: new Set(),
  ...o,
});

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("buildMap", () => {
  it("frames the cinemas and home inside the drawing, and leaves out cinemas with no coordinates", () => {
    const m = buildMap(options());
    for (const d of m.dots.filter((d) => d.focus)) {
      expect(d.x).toBeGreaterThan(0);
      expect(d.x).toBeLessThan(m.width);
      expect(d.y).toBeGreaterThan(0);
      expect(d.y).toBeLessThan(m.height);
    }
    expect(m.home).not.toBeNull();
    expect(m.dots.map((d) => d.id)).not.toContain("nowhere");
  });

  it("puts the sea below the land", () => {
    const m = buildMap(options());
    // Verdi (inland) is above Girona (nearer the sea) once the map is turned.
    const y = (id: string) => m.dots.find((d) => d.id === id)!.y;
    expect(y("verdi")).toBeLessThan(y("girona"));
  });

  it("never lets a label cover a dot", () => {
    const m = buildMap(options({ frame: ["verdi", "girona", "maquinista"], areas: true }));
    for (const l of m.labels) {
      const box = { x: l.x - 2, y: l.y - 10, w: l.text.length * 6.1 + 4, h: 13 };
      for (const d of m.dots) expect(overlaps(box, { x: d.x - 5, y: d.y - 5, w: 10, h: 10 })).toBe(false);
    }
  });

  it("adds a focus cinema's note to its label, and labels Home", () => {
    const m = buildMap(options({ notes: { verdi: "18:00 +2" } }));
    expect(m.labels.map((l) => l.text)).toEqual(expect.arrayContaining(["Home", "verdi · 18:00 +2"]));
  });

  it("pins cinemas outside the frame to its edge with their distance", () => {
    const m = buildMap(options({ edges: true }));
    const pin = m.dots.find((d) => d.id === "maquinista")!;
    expect(pin.edge).toBe(true);
    expect(m.labels.some((l) => /^maquinista [\d.]+ km →$/.test(l.text))).toBe(true);
  });

  it("draws rings at 1, 2 and 3 km round Home unless asked not to", () => {
    expect(buildMap(options({ minSpan: 7, height: 358 })).rings.length).toBe(3);
    expect(buildMap(options({ rings: false })).rings).toEqual([]);
  });

  it("turns a point on the map back into the place drawn there", () => {
    const m = buildMap(options());
    const verdi = m.dots.find((d) => d.id === "verdi")!;
    const place = m.toLatLng(verdi.x, verdi.y);
    expect(place.lat).toBeCloseTo(41.404, 4);
    expect(place.lng).toBeCloseTo(2.1569, 4);
  });
});
